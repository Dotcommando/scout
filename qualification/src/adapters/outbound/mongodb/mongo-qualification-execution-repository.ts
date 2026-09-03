import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection, MongoServerError } from 'mongodb';

import { QUALIFICATION_EXECUTION_STATUS } from '../../../domain/qualification/qualification-model.js';
import {
  IClaimQualificationExecutionInput,
  ICompleteQualificationExecutionInput,
  IQualificationExecutionRepositoryPort,
  QUALIFICATION_EXECUTION_CLAIM_OUTCOME,
} from '../../../ports/outbound/qualification-execution-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface IQualificationExecutionDocument {
  readonly campaignId: string;
  readonly claimedAt?: Date;
  readonly completedAt?: Date;
  readonly executionId: string;
  readonly leadId: string;
  readonly profileVersion: number;
  readonly status: QUALIFICATION_EXECUTION_STATUS;
  readonly workerId?: string;
}

@Injectable()
export class MongoQualificationExecutionRepository
  implements IQualificationExecutionRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IQualificationExecutionDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient
      .getDatabase()
      .collection('qualification_executions');
  }

  public async claimExecution(
    input: IClaimQualificationExecutionInput,
  ): Promise<QUALIFICATION_EXECUTION_CLAIM_OUTCOME> {
    try {
      await this.collection.insertOne({
        campaignId: input.campaignId,
        claimedAt: input.claimedAt,
        executionId: input.executionId,
        leadId: input.leadId,
        profileVersion: input.profileVersion,
        status: QUALIFICATION_EXECUTION_STATUS.PROCESSING,
        workerId: input.workerId,
      });

      return QUALIFICATION_EXECUTION_CLAIM_OUTCOME.CLAIMED;
    } catch (error: unknown) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) {
        throw error;
      }
    }

    const reclaimed = await this.collection.findOneAndUpdate(
      {
        campaignId: input.campaignId,
        leadId: input.leadId,
        profileVersion: input.profileVersion,
        status: QUALIFICATION_EXECUTION_STATUS.PROCESSING,
        $or: [
          { claimedAt: { $lte: input.staleClaimBefore } },
          { claimedAt: { $exists: false } },
        ],
      },
      {
        $set: {
          claimedAt: input.claimedAt,
          workerId: input.workerId,
        },
      },
      { returnDocument: 'after' },
    );

    if (reclaimed !== null) {
      return QUALIFICATION_EXECUTION_CLAIM_OUTCOME.CLAIMED;
    }

    const existing = await this.collection.findOne({
      campaignId: input.campaignId,
      leadId: input.leadId,
      profileVersion: input.profileVersion,
    });

    if (existing?.status === QUALIFICATION_EXECUTION_STATUS.COMPLETED) {
      return QUALIFICATION_EXECUTION_CLAIM_OUTCOME.ALREADY_COMPLETED;
    }

    return QUALIFICATION_EXECUTION_CLAIM_OUTCOME.IN_PROGRESS;
  }

  public async completeExecution(
    input: ICompleteQualificationExecutionInput,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      {
        campaignId: input.campaignId,
        leadId: input.leadId,
        profileVersion: input.profileVersion,
        status: QUALIFICATION_EXECUTION_STATUS.PROCESSING,
        workerId: input.workerId,
      },
      {
        $set: {
          completedAt: input.completedAt,
          status: QUALIFICATION_EXECUTION_STATUS.COMPLETED,
        },
        $unset: {
          claimedAt: '',
          workerId: '',
        },
      },
    );

    return result.modifiedCount === 1;
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      {
        campaignId: 1,
        leadId: 1,
        profileVersion: 1,
      },
      {
        name: 'campaign_lead_profile_execution_unique',
        unique: true,
      },
    );
    await this.collection.createIndex({ executionId: 1 }, { name: 'qualification_execution_id_unique', unique: true });
  }
}
