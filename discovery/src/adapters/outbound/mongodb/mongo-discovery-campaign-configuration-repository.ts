import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import {
  DISCOVERY_CONFIGURATION_LIFECYCLE,
  IDiscoveryCampaignConfiguration,
  IStoredDiscoveryCampaignConfiguration,
} from '../../../app/discovery/discovery-campaign-configuration.js';
import {
  IDiscoveryCampaignConfigurationPage,
  IDiscoveryCampaignConfigurationRepositoryPort,
  IDiscoveryConfigurationArchiveResult,
} from '../../../ports/outbound/discovery-campaign-configuration-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface IDiscoveryCampaignConfigurationDocument extends IStoredDiscoveryCampaignConfiguration {
  readonly createdAt: Date;
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

  public async findConfiguration(
    campaignId: string,
    version: number,
  ): Promise<IStoredDiscoveryCampaignConfiguration | undefined> {
    const document = await this.collection.findOne({ campaignId, version });

    return document === null ? undefined : toStoredConfiguration(document);
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
      items: documents.map((document) => toStoredConfiguration(document)),
      total,
    };
  }

  public async createDraftConfiguration(
    configuration: IDiscoveryCampaignConfiguration,
    createdAt: Date,
  ): Promise<IStoredDiscoveryCampaignConfiguration> {
    const document: IDiscoveryCampaignConfigurationDocument = {
      ...configuration,
      createdAt,
      lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE.DRAFT,
      updatedAt: createdAt,
    };

    await this.collection.insertOne(document);

    return toStoredConfiguration(document);
  }

  public async replaceDraftConfiguration(
    configuration: IDiscoveryCampaignConfiguration,
    expectedVersion: number,
    updatedAt: Date,
  ): Promise<IStoredDiscoveryCampaignConfiguration | undefined> {
    const current = await this.collection.findOne({
      campaignId: configuration.campaignId,
      version: expectedVersion,
    });

    if (current === null) {
      return undefined;
    }

    const document: IDiscoveryCampaignConfigurationDocument = {
      ...configuration,
      createdAt: updatedAt,
      lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE.DRAFT,
      updatedAt,
    };

    await this.collection.insertOne(document);

    return toStoredConfiguration(document);
  }

  public async activateConfiguration(
    campaignId: string,
    expectedVersion: number,
    activatedAt: Date,
  ): Promise<IStoredDiscoveryCampaignConfiguration | undefined> {
    const target = await this.collection.findOne({ campaignId, version: expectedVersion });

    if (target === null || target.lifecycle === DISCOVERY_CONFIGURATION_LIFECYCLE.ARCHIVED) {
      return undefined;
    }

    await this.collection.updateMany(
      { campaignId, lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE.ACTIVE },
      { $set: { lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE.ARCHIVED, updatedAt: activatedAt } },
    );
    const result = await this.collection.findOneAndUpdate(
      { campaignId, version: expectedVersion },
      { $set: { lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE.ACTIVE, updatedAt: activatedAt } },
      { returnDocument: 'after' },
    );

    return result === null ? undefined : toStoredConfiguration(result);
  }

  public async archiveConfigurations(
    campaignIds: readonly string[],
    archivedAt: Date,
  ): Promise<IDiscoveryConfigurationArchiveResult> {
    const documents = await this.collection.find({ campaignId: { $in: campaignIds } }).toArray();
    const foundCampaignIds = new Set(documents.map((document) => document.campaignId));
    const conflicts = campaignIds.flatMap((campaignId) => {
      if (!foundCampaignIds.has(campaignId)) {
        return [{ campaignId, reason: 'not-found' }];
      }
      if (documents.some((document) => document.campaignId === campaignId
        && document.lifecycle === DISCOVERY_CONFIGURATION_LIFECYCLE.ACTIVE)) {
        return [{ campaignId, reason: 'active' }];
      }

      return [];
    });

    if (conflicts.length > 0) {
      return { archivedCampaignIds: [], conflicts };
    }
    await this.collection.updateMany(
      { campaignId: { $in: campaignIds }, lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE.DRAFT },
      { $set: { lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE.ARCHIVED, updatedAt: archivedAt } },
    );

    return { archivedCampaignIds: campaignIds, conflicts: [] };
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

function toStoredConfiguration(
  document: IDiscoveryCampaignConfigurationDocument,
): IStoredDiscoveryCampaignConfiguration {
  return {
    ...toConfiguration(document),
    createdAt: document.createdAt,
    lifecycle: document.lifecycle,
    updatedAt: document.updatedAt,
  };
}
