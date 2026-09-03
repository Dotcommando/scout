import { IDiscoveryCampaignConfiguration } from '../../app/discovery/discovery-campaign-configuration.js';

export const DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY = Symbol(
  'DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY',
);

export interface IDiscoveryCampaignConfigurationRepositoryPort {
  findActiveConfiguration(): Promise<IDiscoveryCampaignConfiguration | undefined>;
  findConfigurations(
    offset: number,
    limit: number,
  ): Promise<IDiscoveryCampaignConfigurationPage>;
  seedActiveConfiguration(
    configuration: IDiscoveryCampaignConfiguration,
    seededAt: Date,
  ): Promise<IDiscoveryCampaignConfiguration>;
}

export interface IDiscoveryCampaignConfigurationPage {
  readonly items: readonly IDiscoveryCampaignConfiguration[];
  readonly total: number;
}
