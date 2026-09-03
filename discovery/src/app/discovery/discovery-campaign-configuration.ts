import { DISCOVERY_SOURCE_KIND } from '../../domain/discovery/discovery-model.js';

export interface IDiscoveryCampaignConfiguration {
  readonly campaignId: string;
  readonly configurationHash: string;
  readonly limits: IDiscoveryCampaignLimits;
  readonly scopes: readonly IDiscoveryScopeConfiguration[];
  readonly searchQueries: readonly string[];
  readonly source: IDiscoverySourceConfiguration;
  readonly version: number;
}

export enum DISCOVERY_CONFIGURATION_LIFECYCLE {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  DRAFT = 'draft',
}

export interface IStoredDiscoveryCampaignConfiguration
  extends IDiscoveryCampaignConfiguration {
  readonly createdAt: Date;
  readonly lifecycle: DISCOVERY_CONFIGURATION_LIFECYCLE;
  readonly updatedAt: Date;
}

export interface IDiscoveryCampaignConfigurationInput {
  readonly campaignId: string;
  readonly limits: IDiscoveryCampaignLimits;
  readonly scopes: readonly IDiscoveryScopeConfiguration[];
  readonly searchQueries: readonly string[];
  readonly source: IDiscoverySourceConfiguration;
}

export interface IDiscoveryCampaignLimits {
  readonly dailyProviderItemLimit: number;
  readonly maxProviderItemsPerRun: number;
}

export interface IDiscoveryScopeConfiguration {
  readonly id: string;
  readonly label: string;
  readonly priority: number;
}

export interface IDiscoverySourceConfiguration {
  readonly actorId: string;
  readonly kind: DISCOVERY_SOURCE_KIND;
}
