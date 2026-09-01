import {
  DiscoveryScopeProgress,
} from '../../domain/discovery/discovery-model.js';

export interface IDiscoveryStateRepositoryPort {
  claimNextEligibleScope(
    input: IClaimNextEligibleScopeInput,
  ): Promise<DiscoveryScopeProgress | null>;
  claimNextActiveScope(
    input: IClaimNextActiveScopeInput,
  ): Promise<DiscoveryScopeProgress | null>;
  findScopeProgress(
    campaignId: string,
    scopeId: string,
  ): Promise<DiscoveryScopeProgress | null>;
  releaseScopeClaim(input: IReleaseScopeClaimInput): Promise<boolean>;
  saveScopeProgress(scope: DiscoveryScopeProgress): Promise<void>;
  synchronizeConfiguredScopes(
    input: ISynchronizeConfiguredScopesInput,
  ): Promise<void>;
}

export interface IClaimNextEligibleScopeInput {
  readonly campaignId: string;
  readonly claimedAt: Date;
  readonly workerId: string;
}

export interface IClaimNextActiveScopeInput {
  readonly campaignId: string;
  readonly claimedAt: Date;
  readonly staleClaimBefore: Date;
  readonly workerId: string;
}

export interface IReleaseScopeClaimInput {
  readonly campaignId: string;
  readonly releasedAt: Date;
  readonly scopeId: string;
  readonly workerId: string;
}

export interface ISynchronizeConfiguredScopesInput {
  readonly campaignId: string;
  readonly configurationHash: string;
  readonly synchronizedAt: Date;
  readonly scopes: readonly ISynchronizedDiscoveryScope[];
}

export interface ISynchronizedDiscoveryScope {
  readonly priority: number;
  readonly scopeId: string;
}
