import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import {
  DISCOVERY_BACKFILL_RUN_STATUS,
  DISCOVERY_SOURCE_KIND,
} from '../../../domain/discovery/discovery-model.js';
import {
  ICompleteDiscoveryBackfillRunInput,
  IDiscoveryBackfillRun,
  IDiscoveryBackfillRunRepositoryPort,
  IFailDiscoveryBackfillRunInput,
  IStartDiscoveryBackfillRunInput,
} from '../../../ports/outbound/discovery-backfill-run-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface IDiscoveryBackfillRunDocument {
  readonly campaignId: string;
  readonly completedAt?: Date;
  readonly configurationHash: string;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly dryRun: boolean;
  readonly failureMessage?: string;
  readonly maximumLeadCount: number;
  readonly leadIdPrefix?: string;
  readonly qualificationCatalogRevision: string;
  readonly runId: string;
  readonly selectedSourceKind: DISCOVERY_SOURCE_KIND;
  readonly status: DISCOVERY_BACKFILL_RUN_STATUS;
  readonly totalExistingOutputCount: number;
  readonly totalInsertedOutputCount: number;
  readonly totalSelectedLeadCount: number;
  readonly updatedAt: Date;
}

@Injectable()
export class MongoDiscoveryBackfillRunRepository
  implements IDiscoveryBackfillRunRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IDiscoveryBackfillRunDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient
      .getDatabase()
      .collection('discovery_backfill_runs');
  }

  public async completeBackfillRun(
    input: ICompleteDiscoveryBackfillRunInput,
  ): Promise<void> {
    await this.collection.updateOne(
      { runId: input.runId },
      {
        $set: {
          completedAt: input.completedAt,
          status: DISCOVERY_BACKFILL_RUN_STATUS.COMPLETED,
          totalExistingOutputCount: input.totalExistingOutputCount,
          totalInsertedOutputCount: input.totalInsertedOutputCount,
          totalSelectedLeadCount: input.totalSelectedLeadCount,
          updatedAt: input.completedAt,
        },
        $unset: { failureMessage: '' },
      },
    );
  }

  public async failBackfillRun(input: IFailDiscoveryBackfillRunInput): Promise<void> {
    await this.collection.updateOne(
      { runId: input.runId },
      {
        $set: {
          failureMessage: input.failureMessage,
          status: DISCOVERY_BACKFILL_RUN_STATUS.FAILED,
          updatedAt: input.failedAt,
        },
      },
    );
  }

  public async findBackfillRun(
    runId: string,
  ): Promise<IDiscoveryBackfillRun | undefined> {
    const document = await this.collection.findOne({ runId });

    return document === null ? undefined : document;
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      { runId: 1 },
      { name: 'backfill_run_id_unique', unique: true },
    );
    await this.collection.createIndex(
      { campaignId: 1, createdAt: 1 },
      { name: 'backfill_campaign_created_at' },
    );
  }

  public async startBackfillRun(
    input: IStartDiscoveryBackfillRunInput,
  ): Promise<IDiscoveryBackfillRun> {
    const result = await this.collection.findOneAndUpdate(
      { runId: input.runId },
      {
        $set: {
          status: DISCOVERY_BACKFILL_RUN_STATUS.RUNNING,
          updatedAt: input.createdAt,
        },
        $setOnInsert: {
          campaignId: input.campaignId,
          configurationHash: input.configurationHash,
          correlationId: input.correlationId,
          createdAt: input.createdAt,
          dryRun: input.dryRun,
          maximumLeadCount: input.maximumLeadCount,
          ...(input.leadIdPrefix === undefined
            ? {}
            : { leadIdPrefix: input.leadIdPrefix }),
          qualificationCatalogRevision: input.qualificationCatalogRevision,
          runId: input.runId,
          selectedSourceKind: input.selectedSourceKind,
          totalExistingOutputCount: 0,
          totalInsertedOutputCount: 0,
          totalSelectedLeadCount: 0,
        },
        $unset: {
          completedAt: '',
          failureMessage: '',
        },
      },
      { returnDocument: 'after', upsert: true },
    );

    if (result === null) {
      throw new Error(`backfill run ${input.runId} could not be started`);
    }

    return result;
  }
}
