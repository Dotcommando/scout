import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import {
  IQualificationConfiguration,
  IStoredQualificationConfiguration,
  QUALIFICATION_CONFIGURATION_LIFECYCLE,
} from '../../../app/qualification/qualification-configuration.js';
import {
  IQualificationConfigurationArchiveResult,
  IQualificationConfigurationPage,
  IQualificationConfigurationRepositoryPort,
} from '../../../ports/outbound/qualification-configuration-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface IQualificationConfigurationDocument extends IStoredQualificationConfiguration {
  readonly seededAt?: Date;
}

@Injectable()
export class MongoQualificationConfigurationRepository implements IQualificationConfigurationRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IQualificationConfigurationDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient.getDatabase().collection('qualification_configurations');
  }

  public async activateConfiguration(campaignId: string, expectedVersion: number, activatedAt: Date): Promise<IStoredQualificationConfiguration | undefined> {
    const target = await this.collection.findOne({ campaignId, version: expectedVersion });

    if (target === null || target.lifecycle === QUALIFICATION_CONFIGURATION_LIFECYCLE.ARCHIVED) {
      return undefined;
    }
    await this.collection.updateMany(
      { campaignId, lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ACTIVE },
      { $set: { lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ARCHIVED, updatedAt: activatedAt } },
    );
    const activated = await this.collection.findOneAndUpdate(
      { campaignId, version: expectedVersion },
      { $set: { lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ACTIVE, updatedAt: activatedAt } },
      { returnDocument: 'after' },
    );

    return activated === null ? undefined : activated;
  }

  public async archiveConfigurations(campaignIds: readonly string[], archivedAt: Date): Promise<IQualificationConfigurationArchiveResult> {
    const documents = await this.collection.find({ campaignId: { $in: campaignIds } }).toArray();
    const found = new Set(documents.map((item) => item.campaignId));
    const conflicts = campaignIds.flatMap((campaignId) => {
      if (!found.has(campaignId)) {
        return [{ campaignId, reason: 'not-found' }];
      }
      if (documents.some((item) => item.campaignId === campaignId
        && item.lifecycle === QUALIFICATION_CONFIGURATION_LIFECYCLE.ACTIVE)) {
        return [{ campaignId, reason: 'active' }];
      }

      return [];
    });

    if (conflicts.length > 0) {
      return { archivedCampaignIds: [], conflicts };
    }
    await this.collection.updateMany(
      { campaignId: { $in: campaignIds }, lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.DRAFT },
      { $set: { lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ARCHIVED, updatedAt: archivedAt } },
    );

    return { archivedCampaignIds: campaignIds, conflicts: [] };
  }

  public async createDraftConfiguration(configuration: IQualificationConfiguration, createdAt: Date): Promise<IStoredQualificationConfiguration> {
    const document: IQualificationConfigurationDocument = {
      ...configuration,
      createdAt,
      lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.DRAFT,
      updatedAt: createdAt,
    };

    await this.collection.insertOne(document);

    return document;
  }

  public async findActiveConfiguration(campaignId: string): Promise<IQualificationConfiguration | undefined> {
    const document = await this.collection.findOne({ campaignId, lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ACTIVE });

    return document === null ? undefined : toConfiguration(document);
  }

  public async findConfigurations(offset: number, limit: number): Promise<IQualificationConfigurationPage> {
    const [items, total] = await Promise.all([
      this.collection.find({}).sort({ campaignId: 1, version: 1 }).skip(offset).limit(limit).toArray(),
      this.collection.countDocuments(),
    ]);

    return { items, total };
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex({ campaignId: 1, version: 1 }, { name: 'qualification_campaign_revision_unique', unique: true });
    await this.collection.createIndex(
      { campaignId: 1, lifecycle: 1 },
      {
        name: 'one_active_qualification_revision_per_campaign',
        partialFilterExpression: { lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ACTIVE },
        unique: true,
      },
    );
  }

  public async replaceDraftConfiguration(configuration: IQualificationConfiguration, expectedVersion: number, updatedAt: Date): Promise<IStoredQualificationConfiguration | undefined> {
    const current = await this.collection.findOne({ campaignId: configuration.campaignId, version: expectedVersion });

    if (current === null || current.lifecycle === QUALIFICATION_CONFIGURATION_LIFECYCLE.ARCHIVED) {
      return undefined;
    }

    const document: IQualificationConfigurationDocument = {
      ...configuration,
      createdAt: updatedAt,
      lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.DRAFT,
      updatedAt,
    };

    await this.collection.insertOne(document);

    return document;
  }

  public async seedActiveConfiguration(configuration: IQualificationConfiguration, seededAt: Date): Promise<IQualificationConfiguration> {
    const document = await this.collection.findOneAndUpdate(
      { campaignId: configuration.campaignId, version: configuration.version },
      {
        $setOnInsert: {
          ...configuration,
          createdAt: seededAt,
          lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ACTIVE,
          seededAt,
          updatedAt: seededAt,
        },
      },
      { returnDocument: 'after', upsert: true },
    );

    if (document === null) {
      throw new Error(`Qualification configuration ${configuration.campaignId} could not be seeded`);
    }

    return toConfiguration(document);
  }
}

function toConfiguration(document: IQualificationConfigurationDocument): IQualificationConfiguration {
  return {
    catalog: document.catalog,
    campaignId: document.campaignId,
    catalogRevision: document.catalogRevision,
    configurationHash: document.configurationHash,
    enrichment: document.enrichment,
    profile: document.profile,
    version: document.version,
  };
}
