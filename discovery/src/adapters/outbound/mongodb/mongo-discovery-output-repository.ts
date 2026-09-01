import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import { DISCOVERY_OUTPUT_STATUS } from '../../../domain/discovery/discovery-model.js';
import {
  IDiscoveryOutputRepositoryPort,
  ISaveDiscoveryOutputInput,
} from '../../../ports/outbound/discovery-output-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface IDiscoveryOutputDocument {
  readonly campaignId: string;
  readonly createdAt: Date;
  readonly leadId: string;
  readonly outputId: string;
  readonly status: DISCOVERY_OUTPUT_STATUS;
}

@Injectable()
export class MongoDiscoveryOutputRepository
  implements IDiscoveryOutputRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IDiscoveryOutputDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient
      .getDatabase()
      .collection('discovery_outputs');
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      {
        campaignId: 1,
        leadId: 1,
      },
      {
        name: 'campaign_lead_output_unique',
        unique: true,
      },
    );
    await this.collection.createIndex(
      {
        outputId: 1,
      },
      {
        name: 'output_id_unique',
        unique: true,
      },
    );
  }

  public async saveDiscoveryOutput(
    input: ISaveDiscoveryOutputInput,
  ): Promise<void> {
    await this.collection.updateOne(
      {
        campaignId: input.campaignId,
        leadId: input.leadId,
      },
      {
        $setOnInsert: input,
      },
      {
        upsert: true,
      },
    );
  }
}
