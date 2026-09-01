import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection, MongoServerError } from 'mongodb';

import {
  DISCOVERY_SOURCE_KIND,
  Lead,
} from '../../../domain/discovery/discovery-model.js';
import {
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

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}
