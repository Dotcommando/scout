import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import {
  DISCOVERY_OPERATION_RUN_STATUS,
  IDiscoveryOperationRun,
  IDiscoveryOperationRunPage,
  IDiscoveryOperationRunRepositoryPort,
} from '../../../ports/outbound/discovery-operation-run-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

@Injectable()
export class MongoDiscoveryOperationRunRepository
  implements IDiscoveryOperationRunRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IDiscoveryOperationRun>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient.getDatabase().collection('discovery_operation_runs');
  }

  public async findByIdempotencyKey(
    campaignId: string,
    idempotencyKey: string,
  ): Promise<IDiscoveryOperationRun | undefined> {
    return (await this.collection.findOne({ campaignId, idempotencyKey })) ?? undefined;
  }

  public async findOldestRunningRun(): Promise<IDiscoveryOperationRun | undefined> {
    return (await this.collection.findOne(
      { status: DISCOVERY_OPERATION_RUN_STATUS.RUNNING },
      { sort: { createdAt: 1, runId: 1 } },
    )) ?? undefined;
  }

  public async claimNextAcceptedRun(claimedAt: Date): Promise<IDiscoveryOperationRun | undefined> {
    return (await this.collection.findOneAndUpdate(
      { status: DISCOVERY_OPERATION_RUN_STATUS.ACCEPTED },
      { $set: { status: DISCOVERY_OPERATION_RUN_STATUS.RUNNING, updatedAt: claimedAt } },
      { returnDocument: 'after', sort: { createdAt: 1, runId: 1 } },
    )) ?? undefined;
  }

  public async findRun(runId: string): Promise<IDiscoveryOperationRun | undefined> {
    return (await this.collection.findOne({ runId })) ?? undefined;
  }

  public async finishActiveCampaignRuns(
    campaignId: string,
    status: DISCOVERY_OPERATION_RUN_STATUS,
    updatedAt: Date,
    failureMessage?: string,
  ): Promise<void> {
    await this.collection.updateMany(
      {
        campaignId,
        status: {
          $in: [
            DISCOVERY_OPERATION_RUN_STATUS.ACCEPTED,
            DISCOVERY_OPERATION_RUN_STATUS.RUNNING,
          ],
        },
      },
      {
        $set: {
          ...(failureMessage === undefined ? {} : { failureMessage }),
          status,
          updatedAt,
        },
      },
    );
  }

  public async listRuns(
    campaignId: string | undefined,
    offset: number,
    limit: number,
  ): Promise<IDiscoveryOperationRunPage> {
    const filter = campaignId === undefined ? {} : { campaignId };
    const [items, total] = await Promise.all([
      this.collection.find(filter).sort({ createdAt: -1, runId: 1 }).skip(offset).limit(limit).toArray(),
      this.collection.countDocuments(filter),
    ]);

    return { items, total };
  }

  public async onModuleInit(): Promise<void> {
    await Promise.all([
      this.collection.createIndex({ runId: 1 }, { name: 'run_id_unique', unique: true }),
      this.collection.createIndex(
        { campaignId: 1, idempotencyKey: 1 },
        { name: 'command_idempotency_unique', unique: true },
      ),
    ]);
  }

  public async saveRun(run: IDiscoveryOperationRun): Promise<void> {
    await this.collection.insertOne(run);
  }

  public async updateRunStatus(
    runId: string,
    status: DISCOVERY_OPERATION_RUN_STATUS,
    updatedAt: Date,
    failureMessage?: string,
  ): Promise<void> {
    await this.collection.updateOne(
      { runId },
      {
        $set: {
          ...(failureMessage === undefined ? {} : { failureMessage }),
          status,
          updatedAt,
        },
      },
    );
  }
}
