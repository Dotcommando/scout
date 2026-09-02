import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection, MongoServerError } from 'mongodb';

import {
  DISCOVERY_SOURCE_KIND,
  Lead,
  LeadSourceIdentity,
} from '../../../domain/discovery/discovery-model.js';
import {
  IFindLeadsForBackfillInput,
  ILeadBackfillPage,
  ILeadRepositoryPort,
  ILeadUpsertResult,
  LEAD_UPSERT_OUTCOME,
} from '../../../ports/outbound/lead-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface ILeadDocument {
  readonly address?: string;
  readonly createdAt: Date;
  readonly externalId: string;
  readonly leadId: string;
  readonly name: string;
  readonly phoneNumber?: string;
  readonly sourceKind: DISCOVERY_SOURCE_KIND;
  readonly updatedAt: Date;
  readonly websiteUrl?: string;
}

@Injectable()
export class MongoLeadRepository implements ILeadRepositoryPort, OnModuleInit {
  private readonly collection: Collection<ILeadDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient.getDatabase().collection('leads');
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      {
        externalId: 1,
        sourceKind: 1,
      },
      {
        name: 'source_identity_unique',
        unique: true,
      },
    );
    await this.collection.createIndex(
      {
        sourceKind: 1,
        leadId: 1,
      },
      {
        name: 'backfill_selection',
      },
    );
  }

  public async findLeadsForBackfill(
    input: IFindLeadsForBackfillInput,
  ): Promise<ILeadBackfillPage> {
    const documents = await this.collection
      .find({
        ...(
          input.afterLeadId === undefined && input.leadIdPrefix === undefined
            ? {}
            : {
              leadId: {
                ...(input.afterLeadId === undefined
                  ? {}
                  : { $gt: input.afterLeadId }),
                ...(input.leadIdPrefix === undefined
                  ? {}
                  : { $regex: createExactPrefixPattern(input.leadIdPrefix) }),
              },
            }
        ),
        sourceKind: input.sourceKind,
      })
      .sort({ leadId: 1 })
      .limit(input.limit)
      .toArray();

    return {
      leads: documents.map((document) => toLead(document)),
    };
  }

  public async upsertLead(lead: Lead): Promise<ILeadUpsertResult> {
    try {
      const result = await this.collection.updateOne(
        {
          externalId: lead.sourceIdentity.externalId,
          sourceKind: lead.sourceIdentity.sourceKind,
        },
        {
          $set: {
            ...lead.details,
            updatedAt: lead.updatedAt,
          },
          $setOnInsert: {
            createdAt: lead.createdAt,
            externalId: lead.sourceIdentity.externalId,
            leadId: lead.leadId,
            sourceKind: lead.sourceIdentity.sourceKind,
          },
        },
        {
          upsert: true,
        },
      );

      return {
        leadId: lead.leadId,
        outcome:
          result.upsertedCount === 1
            ? LEAD_UPSERT_OUTCOME.INSERTED
            : LEAD_UPSERT_OUTCOME.EXISTING,
      };
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      return {
        leadId: lead.leadId,
        outcome: LEAD_UPSERT_OUTCOME.EXISTING,
      };
    }
  }
}

function toLead(document: ILeadDocument): Lead {
  return new Lead(
    document.createdAt,
    {
      ...(document.address === undefined ? {} : { address: document.address }),
      name: document.name,
      ...(document.phoneNumber === undefined
        ? {}
        : { phoneNumber: document.phoneNumber }),
      ...(document.websiteUrl === undefined
        ? {}
        : { websiteUrl: document.websiteUrl }),
    },
    document.leadId,
    new LeadSourceIdentity(document.externalId, document.sourceKind),
    document.updatedAt,
  );
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

function createExactPrefixPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}
