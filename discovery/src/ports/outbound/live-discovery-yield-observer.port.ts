export interface ILiveDiscoveryYieldObserverPort {
  recordImportedBatch(input: ILiveDiscoveryImportedBatch): Promise<boolean>;
}

export interface ILiveDiscoveryImportedBatch {
  readonly batchInsertedLeadCount: number;
  readonly batchProviderItemCount: number;
  readonly campaignId: string;
  readonly occurredAt: Date;
  readonly providerRunId: string;
  readonly scopeId: string;
}
