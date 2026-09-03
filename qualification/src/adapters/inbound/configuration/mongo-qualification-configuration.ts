import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import { IKnownAffiliationCatalog } from '../../../domain/qualification/known-affiliation-catalog.js';
import { IQualificationProfile } from '../../../domain/qualification/qualification-model.js';
import { IKnownAffiliationCatalogConfigurationPort } from '../../../ports/outbound/known-affiliation-catalog-configuration.port.js';
import { IQualificationEnrichmentConfiguration, IQualificationEnrichmentConfigurationPort } from '../../../ports/outbound/qualification-enrichment-configuration.port.js';
import { IQualificationProfileConfigurationPort } from '../../../ports/outbound/qualification-profile-configuration.port.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { loadKnownAffiliationCatalog } from './known-affiliation-catalog-configuration.js';
import { loadQualificationEnrichmentConfiguration } from './qualification-enrichment-configuration.js';
import { loadQualificationProfileConfiguration } from './qualification-profile-configuration.js';

export enum QUALIFICATION_CONFIGURATION_LIFECYCLE {
  ACTIVE = 'active',
}

interface IQualificationConfigurationDocument {
  readonly campaignId: string;
  readonly catalog: IKnownAffiliationCatalog;
  readonly createdAt: Date;
  readonly enrichment: IQualificationEnrichmentConfiguration;
  readonly lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE;
  readonly profile: IQualificationProfile;
  readonly updatedAt: Date;
}

export interface IQualificationConfigurationPage {
  readonly items: readonly IQualificationConfigurationDocument[];
  readonly total: number;
}

@Injectable()
export class MongoQualificationConfiguration
  implements
    IKnownAffiliationCatalogConfigurationPort,
    IQualificationEnrichmentConfigurationPort,
    IQualificationProfileConfigurationPort,
    OnModuleInit {
  private readonly collection: Collection<IQualificationConfigurationDocument>;
  private catalog: IKnownAffiliationCatalog | undefined;
  private readonly enrichments = new Map<string, IQualificationEnrichmentConfiguration>();
  private readonly profiles = new Map<string, IQualificationProfile>();

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient.getDatabase().collection('qualification_configurations');
  }

  public getCatalog(): IKnownAffiliationCatalog {
    if (this.catalog === undefined) {
      throw new Error('Qualification configuration is not initialized');
    }

    return this.catalog;
  }

  public getConfiguration(campaignId: string): IQualificationEnrichmentConfiguration {
    const configuration = this.enrichments.get(campaignId);

    if (configuration === undefined) {
      throw new Error(`No qualification enrichment configuration exists for campaign: ${campaignId}`);
    }

    return configuration;
  }

  public getProfile(campaignId: string): IQualificationProfile {
    const profile = this.profiles.get(campaignId);

    if (profile === undefined) {
      throw new Error(`No qualification profile exists for campaign: ${campaignId}`);
    }

    return profile;
  }

  public async getConfigurations(
    offset: number,
    limit: number,
  ): Promise<IQualificationConfigurationPage> {
    const [items, total] = await Promise.all([
      this.collection.find({ lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ACTIVE })
        .sort({ campaignId: 1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      this.collection.countDocuments({ lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ACTIVE }),
    ]);

    return { items, total };
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      { campaignId: 1, lifecycle: 1 },
      {
        name: 'active_campaign_configuration_unique',
        partialFilterExpression: { lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ACTIVE },
        unique: true,
      },
    );
    const existing = await this.collection.find({
      lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ACTIVE,
    }).toArray();
    const documents = existing.length === 0 ? await this.seedConfiguration() : existing;

    for (const document of documents) {
      this.profiles.set(document.campaignId, document.profile);
      this.enrichments.set(document.campaignId, document.enrichment);
      this.catalog = document.catalog;
    }
  }

  private async seedConfiguration(): Promise<readonly IQualificationConfigurationDocument[]> {
    const profileConfiguration = loadQualificationProfileConfiguration();
    const enrichmentConfigurations = loadQualificationEnrichmentConfiguration();
    const catalog = loadKnownAffiliationCatalog();
    const createdAt = new Date();
    const documents = profileConfiguration.profiles.map((profile) => {
      const enrichment = enrichmentConfigurations.get(profile.campaignId);

      if (enrichment === undefined) {
        throw new Error(`No enrichment configuration exists for campaign: ${profile.campaignId}`);
      }

      return {
        campaignId: profile.campaignId,
        catalog,
        createdAt,
        enrichment,
        lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE.ACTIVE,
        profile,
        updatedAt: createdAt,
      };
    });

    await this.collection.insertMany(documents, { ordered: true });

    return documents;
  }
}
