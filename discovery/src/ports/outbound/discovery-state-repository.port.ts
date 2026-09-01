import {
  DiscoveryScopeProgress,
} from '../../domain/discovery/discovery-model.js';

export interface IDiscoveryStateRepositoryPort {
  claimNextEligibleScope(
    input: IClaimNextEligibleScopeInput,
  ): Promise<DiscoveryScopeProgress | null>;
  findScopeProgress(
    campaignId: string,
    scopeId: string,
  ): Promise<DiscoveryScopeProgress | null>;
  saveScopeProgress(scope: DiscoveryScopeProgress): Promise<void>;
}

export interface IClaimNextEligibleScopeInput {
  readonly campaignId: string;
  readonly claimedAt: Date;
  readonly workerId: string;
}
