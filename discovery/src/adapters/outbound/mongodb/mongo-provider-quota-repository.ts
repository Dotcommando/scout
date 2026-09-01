import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection, MongoServerError } from 'mongodb';

import {
  IProviderQuotaRepositoryPort,
  IProviderQuotaReservation,
  IReserveDailyQuotaInput,
} from '../../../ports/outbound/provider-quota-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface IProviderQuotaUsageDocument {
  readonly campaignId: string;
  readonly lastReservedItemCount?: number;
  readonly quotaDay: string;
  readonly reservedItemCount: number;
  readonly updatedAt: Date;
}

@Injectable()
export class MongoProviderQuotaRepository
  implements IProviderQuotaRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IProviderQuotaUsageDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient
      .getDatabase()
      .collection('provider_quota_usage');
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      {
        campaignId: 1,
        quotaDay: 1,
      },
      {
        name: 'campaign_quota_day_unique',
        unique: true,
      },
    );
  }

  public async reserveDailyQuota(
    input: IReserveDailyQuotaInput,
  ): Promise<IProviderQuotaReservation | null> {
    if (
      input.requestedItemCount < 1
      || input.requestedItemCount > input.dailyItemLimit
    ) {
      return null;
    }

    await this.ensureQuotaUsageDocument(input);

    const document = await this.collection.findOneAndUpdate(
      {
        campaignId: input.campaignId,
        quotaDay: input.quotaDay,
      },
      [
        {
          $set: {
            lastReservedItemCount: {
              $min: [
                input.requestedItemCount,
                {
                  $max: [
                    0,
                    {
                      $subtract: [
                        input.dailyItemLimit,
                        '$reservedItemCount',
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          $set: {
            reservedItemCount: {
              $add: ['$reservedItemCount', '$lastReservedItemCount'],
            },
            updatedAt: new Date(),
          },
        },
      ],
      {
        returnDocument: 'after',
      },
    );

    return document?.lastReservedItemCount === undefined
      || document.lastReservedItemCount === 0
      ? null
      : {
          campaignId: document.campaignId,
          quotaDay: document.quotaDay,
          reservedItemCount: document.lastReservedItemCount,
        };
  }

  private async ensureQuotaUsageDocument(
    input: IReserveDailyQuotaInput,
  ): Promise<void> {
    try {
      await this.collection.updateOne(
        {
          campaignId: input.campaignId,
          quotaDay: input.quotaDay,
        },
        {
          $setOnInsert: {
            campaignId: input.campaignId,
            quotaDay: input.quotaDay,
            reservedItemCount: 0,
            updatedAt: new Date(),
          },
        },
        {
          upsert: true,
        },
      );
    } catch (error: unknown) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) {
        throw error;
      }
    }
  }
}
