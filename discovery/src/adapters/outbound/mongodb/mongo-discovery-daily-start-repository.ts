import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import {
  DISCOVERY_DAILY_START_DECISION,
  IDiscoveryDailyStartClaimInput,
  IDiscoveryDailyStartClaimResult,
  IDiscoveryDailyStartRecord,
  IDiscoveryDailyStartRepositoryPort,
} from '../../../ports/outbound/discovery-daily-start-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

@Injectable()
export class MongoDiscoveryDailyStartRepository
  implements IDiscoveryDailyStartRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IDiscoveryDailyStartRecord>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient.getDatabase().collection('discovery_daily_starts');
  }

  public async claimDailyStart(
    input: IDiscoveryDailyStartClaimInput,
  ): Promise<IDiscoveryDailyStartClaimResult> {
    const result = await this.collection.updateOne(
      {
        businessDate: input.businessDate,
        campaignId: input.campaignId,
        trigger: input.trigger,
      },
      { $setOnInsert: { ...input, createdAt: input.occurredAt } },
      { upsert: true },
    );
    const created = await this.collection.findOne({
      businessDate: input.businessDate,
      campaignId: input.campaignId,
      trigger: input.trigger,
    });

    if (created === null) {
      throw new Error('daily start claim could not be persisted');
    }

    return {
      decision: result.upsertedCount === 1
        ? DISCOVERY_DAILY_START_DECISION.STARTED
        : DISCOVERY_DAILY_START_DECISION.ALREADY_DECIDED,
      record: created,
    };
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      { campaignId: 1, businessDate: 1, trigger: 1 },
      { name: 'daily_start_unique', unique: true },
    );
  }
}
