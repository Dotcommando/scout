import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import {
  createQualificationConfiguration,
  IQualificationConfiguration,
} from '../../../app/qualification/qualification-configuration.js';
import { IKnownAffiliationCatalog } from '../../../domain/qualification/known-affiliation-catalog.js';
import { IQualificationProfile } from '../../../domain/qualification/qualification-model.js';
import { IKnownAffiliationCatalogConfigurationPort } from '../../../ports/outbound/known-affiliation-catalog-configuration.port.js';
import type { IQualificationConfigurationRepositoryPort } from '../../../ports/outbound/qualification-configuration-repository.port.js';
import { QUALIFICATION_CONFIGURATION_REPOSITORY } from '../../../ports/outbound/qualification-configuration-repository.port.js';
import { IQualificationConfigurationRuntimePort } from '../../../ports/outbound/qualification-configuration-runtime.port.js';
import { IQualificationEnrichmentConfiguration, IQualificationEnrichmentConfigurationPort } from '../../../ports/outbound/qualification-enrichment-configuration.port.js';
import { IQualificationProfileConfigurationPort } from '../../../ports/outbound/qualification-profile-configuration.port.js';
import { loadKnownAffiliationCatalog } from './known-affiliation-catalog-configuration.js';
import { loadQualificationEnrichmentConfiguration } from './qualification-enrichment-configuration.js';
import { loadQualificationProfileConfiguration } from './qualification-profile-configuration.js';

@Injectable()
export class MongoQualificationConfiguration
  implements IKnownAffiliationCatalogConfigurationPort, IQualificationEnrichmentConfigurationPort, IQualificationProfileConfigurationPort, IQualificationConfigurationRuntimePort, OnModuleInit {
  private catalog: IKnownAffiliationCatalog | undefined;
  private readonly enrichments = new Map<string, IQualificationEnrichmentConfiguration>();
  private readonly profiles = new Map<string, IQualificationProfile>();

  public constructor(
    @Inject(QUALIFICATION_CONFIGURATION_REPOSITORY)
    private readonly configurationRepository: IQualificationConfigurationRepositoryPort,
  ) {}

  public getCatalog(): IKnownAffiliationCatalog {
    if (this.catalog === undefined) {
      throw new Error('Qualification configuration is not initialized');
    }

    return this.catalog;
  }

  public activateConfiguration(configuration: IQualificationConfiguration): void {
    this.profiles.set(configuration.campaignId, configuration.profile);
    this.enrichments.set(configuration.campaignId, configuration.enrichment);
    this.catalog = configuration.catalog;
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

  public async onModuleInit(): Promise<void> {
    const initial = await this.loadOrSeedConfigurations();

    for (const configuration of initial) {
      this.activateConfiguration(configuration);
    }
  }

  private async loadOrSeedConfigurations(): Promise<readonly IQualificationConfiguration[]> {
    const existing = await this.configurationRepository.findConfigurations(0, 100);
    const active = existing.items.filter((item) => item.lifecycle === 'active');

    if (active.length > 0) {
      return active;
    }

    const profiles = loadQualificationProfileConfiguration().profiles;
    const enrichments = loadQualificationEnrichmentConfiguration();
    const catalog = loadKnownAffiliationCatalog();
    const seededAt = new Date();

    return Promise.all(profiles.map(async (profile) => {
      const enrichment = enrichments.get(profile.campaignId);

      if (enrichment === undefined) {
        throw new Error(`No enrichment configuration exists for campaign: ${profile.campaignId}`);
      }

      return this.configurationRepository.seedActiveConfiguration(
        createQualificationConfiguration({
          campaignId: profile.campaignId,
          catalogRevision: catalog.revision,
          enrichment,
          excludedSourceIdentities: profile.excludedSourceIdentities,
          excludedWebsiteHosts: profile.excludedWebsiteHosts,
          ...(profile.knownAffiliationScopes === undefined ? {} : { knownAffiliationScopes: profile.knownAffiliationScopes }),
          profileId: profile.profileId,
          requirements: profile.requirements,
        }, profile.version, catalog),
        seededAt,
      );
    }));
  }
}
