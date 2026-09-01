import { IDiscoveryCampaignConfiguration } from '../../app/discovery/discovery-campaign-configuration.js';

export interface IDiscoveryCampaignConfigurationPort {
  getCampaignConfiguration(): IDiscoveryCampaignConfiguration;
}
