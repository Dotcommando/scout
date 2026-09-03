import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import { IDiscoveryCampaignConfiguration } from '../../../app/discovery/discovery-campaign-configuration.js';
import { IDiscoveryCampaignConfigurationPort } from '../../../ports/outbound/discovery-campaign-configuration.port.js';
import type { IDiscoveryCampaignConfigurationRepositoryPort } from '../../../ports/outbound/discovery-campaign-configuration-repository.port.js';
import {
  DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY,
} from '../../../ports/outbound/discovery-campaign-configuration-repository.port.js';
import { loadDiscoveryCampaignConfiguration } from './discovery-campaign-configuration.js';

@Injectable()
export class MongoDiscoveryCampaignConfiguration
  implements IDiscoveryCampaignConfigurationPort, OnModuleInit {
  private configuration: IDiscoveryCampaignConfiguration | undefined;

  public constructor(
    @Inject(DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY)
    private readonly configurationRepository: IDiscoveryCampaignConfigurationRepositoryPort,
  ) {}

  public getCampaignConfiguration(): IDiscoveryCampaignConfiguration {
    if (this.configuration === undefined) {
      throw new Error('Discovery campaign configuration is not initialized');
    }

    return this.configuration;
  }

  public async onModuleInit(): Promise<void> {
    const activeConfiguration = await this.configurationRepository.findActiveConfiguration();

    this.configuration = activeConfiguration
      ?? await this.configurationRepository.seedActiveConfiguration(
        loadDiscoveryCampaignConfiguration(),
        new Date(),
      );
  }
}
