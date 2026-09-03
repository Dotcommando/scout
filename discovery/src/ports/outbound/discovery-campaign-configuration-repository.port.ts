import { IDiscoveryCampaignConfiguration } from '../../app/discovery/discovery-campaign-configuration.js';

export const DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY = Symbol(
  'DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY',
);

export interface IDiscoveryCampaignConfigurationRepositoryPort {
  findActiveConfiguration(): Promise<IDiscoveryCampaignConfiguration | undefined>;
  seedActiveConfiguration(
    configuration: IDiscoveryCampaignConfiguration,
    seededAt: Date,
  ): Promise<IDiscoveryCampaignConfiguration>;
}
