import { IDiscoveryCampaignConfiguration } from '../../app/discovery/discovery-campaign-configuration.js';

export const GET_DISCOVERY_CONFIGURATIONS_USE_CASE = Symbol(
  'GET_DISCOVERY_CONFIGURATIONS_USE_CASE',
);

export interface IDiscoveryConfigurationPage {
  readonly items: readonly IDiscoveryCampaignConfiguration[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface IGetDiscoveryConfigurationsUseCase {
  getConfigurations(offset: number, limit: number): Promise<IDiscoveryConfigurationPage>;
}
