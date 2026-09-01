export interface IClaimNextDiscoveryScopeUseCase {
  claimNextEligibleScope(input: IClaimNextDiscoveryScopeInput): Promise<void>;
}

export interface IClaimNextDiscoveryScopeInput {
  readonly correlationId: string;
  readonly workerId: string;
}
