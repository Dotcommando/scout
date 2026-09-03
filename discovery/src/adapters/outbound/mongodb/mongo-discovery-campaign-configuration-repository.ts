import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import {
  IDiscoveryCampaignConfiguration,
} from '../../../app/discovery/discovery-campaign-configuration.js';
import {
  IDiscoveryCampaignConfigurationPage,
  IDiscoveryCampaignConfigurationRepositoryPort,
} from '../../../ports/outbound/discovery-campaign-configuration-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

enum DISCOVERY_CONFIGURATION_LIFECYCLE {
  ACTIVE = 'active',
}

interface IDiscoveryCampaignConfigurationDocument extends IDiscoveryCampaignConfiguration {
  readonly createdAt: Date;
  readonly lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE;
  readonly seededAt?: Date;
  readonly updatedAt: Date;
}

@Injectable()
export class MongoDiscoveryCampaignConfigurationRepository
  implements IDiscoveryCampaignConfigurationRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IDiscoveryCampaignConfigurationDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient
      .getDatabase()
      .collection('discovery_campaign_configurations');
  }

  public async findActiveConfiguration(): Promise<IDiscoveryCampaignConfiguration | undefined> {
    const document = await this.collection.findOne({
      lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE.ACTIVE,
    });

    return document === null ? undefined : toConfiguration(document);
  }

  public async findConfigurations(
    offset: number,
    limit: number,
  ): Promise<IDiscoveryCampaignConfigurationPage> {
    const [documents, total] = await Promise.all([
      this.collection
        .find({})
        .sort({ campaignId: 1, version: 1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      this.collection.countDocuments(),
    ]);

    return {
      items: documents.map((document) => toConfiguration(document)),
      total,
    };
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      { campaignId: 1, version: 1 },
      { name: 'campaign_revision_unique', unique: true },
    );
    await this.collection.createIndex(
      { campaignId: 1, lifecycle: 1 },
      {
        name: 'one_active_revision_per_campaign',
        partialFilterExpression: {
          lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE.ACTIVE,
        },
        unique: true,
      },
    );
  }

  public async seedActiveConfiguration(
    configuration: IDiscoveryCampaignConfiguration,
    seededAt: Date,
  ): Promise<IDiscoveryCampaignConfiguration> {
    const document = await this.collection.findOneAndUpdate(
      { campaignId: configuration.campaignId, version: configuration.version },
      {
        $setOnInsert: {
          ...configuration,
          createdAt: seededAt,
          lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE.ACTIVE,
          seededAt,
          updatedAt: seededAt,
        },
      },
      { returnDocument: 'after', upsert: true },
    );

    if (document === null) {
      throw new Error(`Discovery configuration ${configuration.campaignId} could not be seeded`);
    }

    return toConfiguration(document);
  }
}

function toConfiguration(
  document: IDiscoveryCampaignConfigurationDocument,
): IDiscoveryCampaignConfiguration {
  return {
    campaignId: document.campaignId,
    configurationHash: document.configurationHash,
    limits: document.limits,
    scopes: document.scopes,
    searchQueries: document.searchQueries,
    source: document.source,
    version: document.version,
  };
}
