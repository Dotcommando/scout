export interface ILiveDiscoveryExecutionConfiguration {
  readonly maximumPlanProviderItems: number;
  readonly maximumPlanProviderRuns: number;
  readonly maximumProviderItemsPerRun: number;
  readonly minimumUniqueLeadRate: number;
  readonly minimumYieldEvaluationProviderItems: number;
  readonly planId: string;
  readonly preflightMaximumProviderItems: number;
  readonly version: number;
}
