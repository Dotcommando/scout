import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection, MongoServerError } from 'mongodb';

import {
  LIVE_DISCOVERY_EXECUTION_PURPOSE,
  LIVE_DISCOVERY_EXECUTION_STATUS,
  LIVE_DISCOVERY_PAUSE_REASON,
} from '../../../domain/discovery/live-discovery-execution-model.js';
import {
  ILiveDiscoveryExecutionRepositoryPort,
  ILiveImportedBatchRecord,
  ILiveProviderRunReservation,
  IPauseLiveDiscoveryExecutionInput,
  IRecordLiveImportedBatchInput,
  IReserveLiveProviderRunInput,
} from '../../../ports/outbound/live-discovery-execution-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface ILiveDiscoveryExecutionDocument {
  readonly batchSequence?: number;
  readonly campaignId: string;
  readonly configurationHash: string;
  readonly executionId: string;
  readonly lastReservedAt: Date;
  readonly maximumItemCount: number;
  readonly planProviderItemCount: number;
  readonly planProviderRunCount: number;
  readonly purpose: LIVE_DISCOVERY_EXECUTION_PURPOSE;
  readonly startedAt: Date;
  readonly status: LIVE_DISCOVERY_EXECUTION_STATUS;
  readonly cumulativeInsertedLeadCount?: number;
  readonly cumulativeProviderItemCount?: number;
  readonly pauseReason?: LIVE_DISCOVERY_PAUSE_REASON;
}

interface ILiveDiscoveryPlanUsageDocument {
  readonly planId: string;
  readonly providerItemCount: number;
  readonly providerRunCount: number;
  readonly updatedAt: Date;
}

@Injectable()
export class MongoLiveDiscoveryExecutionRepository
  implements ILiveDiscoveryExecutionRepositoryPort, OnModuleInit {
  private readonly executions: Collection<ILiveDiscoveryExecutionDocument>;
  private readonly planUsage: Collection<ILiveDiscoveryPlanUsageDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.executions = mongoDatabaseClient.getDatabase().collection('live_discovery_executions');
    this.planUsage = mongoDatabaseClient.getDatabase().collection('live_discovery_plan_usage');
  }

  public async onModuleInit(): Promise<void> {
    await this.executions.createIndex({ executionId: 1 }, { name: 'live_execution_id_unique', unique: true });
    await this.planUsage.createIndex({ planId: 1 }, { name: 'live_plan_id_unique', unique: true });
  }

  public async pauseExecution(input: IPauseLiveDiscoveryExecutionInput): Promise<void> {
    await this.executions.updateOne(
      { executionId: input.executionId },
      {
        $set: {
          lastReservedAt: input.pausedAt,
          pauseReason: input.reason,
          status: LIVE_DISCOVERY_EXECUTION_STATUS.PAUSED,
        },
      },
    );
  }

  public async recordImportedBatch(
    input: IRecordLiveImportedBatchInput,
  ): Promise<ILiveImportedBatchRecord> {
    const document = await this.executions.findOneAndUpdate(
      { executionId: input.executionId, status: LIVE_DISCOVERY_EXECUTION_STATUS.ACTIVE },
      [
        {
          $set: {
            batchSequence: { $add: [{ $ifNull: ['$batchSequence', 0] }, 1] },
            cumulativeInsertedLeadCount: {
              $add: [{ $ifNull: ['$cumulativeInsertedLeadCount', 0] }, input.batchInsertedLeadCount],
            },
            cumulativeProviderItemCount: {
              $add: [{ $ifNull: ['$cumulativeProviderItemCount', 0] }, input.batchProviderItemCount],
            },
          },
        },
        {
          $set: {
            status: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$cumulativeProviderItemCount', input.minimumYieldEvaluationProviderItems] },
                    {
                      $lte: [
                        { $divide: ['$cumulativeInsertedLeadCount', '$cumulativeProviderItemCount'] },
                        input.minimumUniqueLeadRate,
                      ],
                    },
                  ],
                },
                LIVE_DISCOVERY_EXECUTION_STATUS.PAUSED,
                LIVE_DISCOVERY_EXECUTION_STATUS.ACTIVE,
              ],
            },
            pauseReason: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$cumulativeProviderItemCount', input.minimumYieldEvaluationProviderItems] },
                    {
                      $lte: [
                        { $divide: ['$cumulativeInsertedLeadCount', '$cumulativeProviderItemCount'] },
                        input.minimumUniqueLeadRate,
                      ],
                    },
                  ],
                },
                LIVE_DISCOVERY_PAUSE_REASON.UNIQUE_YIELD_THRESHOLD,
                '$pauseReason',
              ],
            },
          },
        },
      ],
      { returnDocument: 'after' },
    );

    if (document === null) {
      throw new Error(`active live execution ${input.executionId} does not exist`);
    }

    const cumulativeProviderItemCount = document.cumulativeProviderItemCount ?? 0;
    const cumulativeInsertedLeadCount = document.cumulativeInsertedLeadCount ?? 0;

    return {
      batchSequence: document.batchSequence ?? 0,
      cumulativeInsertedLeadCount,
      cumulativeProviderItemCount,
      paused: document.status === LIVE_DISCOVERY_EXECUTION_STATUS.PAUSED,
      uniqueLeadRate: cumulativeProviderItemCount === 0
        ? 0
        : cumulativeInsertedLeadCount / cumulativeProviderItemCount,
    };
  }

  public async reserveProviderRun(
    input: IReserveLiveProviderRunInput,
  ): Promise<ILiveProviderRunReservation | null> {
    await this.ensurePlanUsage(input);
    const usage = await this.planUsage.findOneAndUpdate(
      {
        planId: input.planId,
        providerItemCount: { $lte: input.maximumPlanProviderItems - input.maximumItemCount },
        providerRunCount: { $lte: input.maximumPlanProviderRuns - 1 },
      },
      {
        $inc: { providerItemCount: input.maximumItemCount, providerRunCount: 1 },
        $set: { updatedAt: input.reservedAt },
      },
      { returnDocument: 'after' },
    );

    if (usage === null) {
      return null;
    }

    await this.executions.updateOne(
      { executionId: input.executionId },
      {
        $set: { lastReservedAt: input.reservedAt, status: LIVE_DISCOVERY_EXECUTION_STATUS.ACTIVE },
        $setOnInsert: {
          campaignId: input.campaignId,
          configurationHash: input.configurationHash,
          executionId: input.executionId,
          maximumItemCount: input.maximumItemCount,
          planProviderItemCount: 0,
          planProviderRunCount: 0,
          purpose: input.purpose,
          startedAt: input.reservedAt,
        },
        $inc: { planProviderItemCount: input.maximumItemCount, planProviderRunCount: 1 },
      },
      { upsert: true },
    );

    return {
      executionId: input.executionId,
      maximumItemCount: input.maximumItemCount,
      planProviderItemCount: usage.providerItemCount,
      planProviderRunCount: usage.providerRunCount,
    };
  }

  private async ensurePlanUsage(input: IReserveLiveProviderRunInput): Promise<void> {
    try {
      await this.planUsage.updateOne(
        { planId: input.planId },
        { $setOnInsert: { planId: input.planId, providerItemCount: 0, providerRunCount: 0, updatedAt: input.reservedAt } },
        { upsert: true },
      );
    } catch (error: unknown) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) {
        throw error;
      }
    }
  }
}
