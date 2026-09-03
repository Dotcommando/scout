import {
  IDiscoveryCampaignConfiguration,
  IStoredDiscoveryCampaignConfiguration,
} from '../../app/discovery/discovery-campaign-configuration.js';

export const DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY = Symbol(
  'DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY',
);

export interface IDiscoveryCampaignConfigurationRepositoryPort {
  activateConfiguration(campaignId: string, expectedVersion: number, activatedAt: Date): Promise<IStoredDiscoveryCampaignConfiguration | undefined>;
  archiveConfigurations(campaignIds: readonly string[], archivedAt: Date): Promise<IDiscoveryConfigurationArchiveResult>;
  createDraftConfiguration(configuration: IDiscoveryCampaignConfiguration, createdAt: Date): Promise<IStoredDiscoveryCampaignConfiguration>;
  findActiveConfiguration(): Promise<IDiscoveryCampaignConfiguration | undefined>;
  findConfigurations(
    offset: number,
    limit: number,
  ): Promise<IDiscoveryCampaignConfigurationPage>;
  findConfiguration(campaignId: string, version: number): Promise<IStoredDiscoveryCampaignConfiguration | undefined>;
  replaceDraftConfiguration(configuration: IDiscoveryCampaignConfiguration, expectedVersion: number, updatedAt: Date): Promise<IStoredDiscoveryCampaignConfiguration | undefined>;
  seedActiveConfiguration(
    configuration: IDiscoveryCampaignConfiguration,
    seededAt: Date,
  ): Promise<IDiscoveryCampaignConfiguration>;
}

export interface IDiscoveryCampaignConfigurationPage {
  readonly items: readonly IStoredDiscoveryCampaignConfiguration[];
  readonly total: number;
}

export interface IDiscoveryConfigurationArchiveResult {
  readonly archivedCampaignIds: readonly string[];
  readonly conflicts: readonly IDiscoveryConfigurationArchiveConflict[];
}

export interface IDiscoveryConfigurationArchiveConflict {
  readonly campaignId: string;
  readonly reason: string;
}
