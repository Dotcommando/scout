import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import {
  QualificationDecision,
  QualificationReason,
} from '../../../domain/qualification/qualification-model.js';
import {
  IQualificationDecisionRecord,
  IQualificationDecisionRepositoryPort,
} from '../../../ports/outbound/qualification-decision-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface IQualificationDecisionDocument extends IQualificationDecisionRecord {
  readonly decision: {
    readonly decision: QualificationDecision['decision'];
    readonly reasons: readonly {
      readonly code: QualificationReason['code'];
      readonly ruleKind: QualificationReason['ruleKind'];
    }[];
  };
}

@Injectable()
export class MongoQualificationDecisionRepository
  implements IQualificationDecisionRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IQualificationDecisionDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient
      .getDatabase()
      .collection('qualification_decisions');
  }

  public async findDecision(
    campaignId: string,
    leadId: string,
    profileVersion: number,
  ): Promise<IQualificationDecisionRecord | null> {
    const document = await this.collection.findOne({
      campaignId,
      'lead.leadId': leadId,
      profileVersion,
    });

    return document === null ? null : toDecisionRecord(document);
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      {
        campaignId: 1,
        'lead.leadId': 1,
        profileVersion: 1,
      },
      {
        name: 'campaign_lead_profile_decision_unique',
        unique: true,
      },
    );
  }

  public async saveDecision(input: IQualificationDecisionRecord): Promise<void> {
    await this.collection.updateOne(
      {
        campaignId: input.campaignId,
        'lead.leadId': input.lead.leadId,
        profileVersion: input.profileVersion,
      },
      {
        $setOnInsert: {
          ...input,
          decision: {
            decision: input.decision.decision,
            reasons: input.decision.reasons.map((reason) => ({
              code: reason.code,
              ruleKind: reason.ruleKind,
            })),
          },
        },
      },
      { upsert: true },
    );
  }
}

function toDecisionRecord(
  document: IQualificationDecisionDocument,
): IQualificationDecisionRecord {
  return {
    ...document,
    decision: new QualificationDecision(
      document.decision.decision,
      document.decision.reasons.map(
        (reason) => new QualificationReason(reason.code, reason.ruleKind),
      ),
    ),
  };
}
