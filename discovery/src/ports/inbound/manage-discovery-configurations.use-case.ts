import {
  IDiscoveryCampaignConfigurationInput,
  IStoredDiscoveryCampaignConfiguration,
} from '../../app/discovery/discovery-campaign-configuration.js';
import { IDiscoveryConfigurationArchiveResult } from '../outbound/discovery-campaign-configuration-repository.port.js';

export const MANAGE_DISCOVERY_CONFIGURATIONS_USE_CASE = Symbol(
  'MANAGE_DISCOVERY_CONFIGURATIONS_USE_CASE',
);

export interface IManageDiscoveryConfigurationsUseCase {
  activateConfiguration(campaignId: string, expectedVersion: number): Promise<IStoredDiscoveryCampaignConfiguration>;
  archiveConfigurations(campaignIds: readonly string[]): Promise<IDiscoveryConfigurationArchiveResult>;
  createConfiguration(input: IDiscoveryCampaignConfigurationInput): Promise<IStoredDiscoveryCampaignConfiguration>;
  replaceConfiguration(
    campaignId: string,
    expectedVersion: number,
    input: IDiscoveryCampaignConfigurationInput,
  ): Promise<IStoredDiscoveryCampaignConfiguration>;
}
