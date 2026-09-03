export enum DISCOVERY_OPERATION_RUN_STATUS {
  ACCEPTED = 'accepted',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RUNNING = 'running',
}

export enum DISCOVERY_OPERATION_RUN_TRIGGER {
  MANUAL = 'manual',
}

export interface IDiscoveryOperationRun {
  readonly campaignId: string;
  readonly configurationHash: string;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly failureMessage?: string;
  readonly idempotencyKey: string;
  readonly maximumProviderItems: number;
  readonly runId: string;
  readonly status: DISCOVERY_OPERATION_RUN_STATUS;
  readonly trigger: DISCOVERY_OPERATION_RUN_TRIGGER;
  readonly updatedAt: Date;
}

export const DISCOVERY_OPERATION_RUN_REPOSITORY = Symbol('DISCOVERY_OPERATION_RUN_REPOSITORY');

export interface IDiscoveryOperationRunRepositoryPort {
  claimNextAcceptedRun(claimedAt: Date): Promise<IDiscoveryOperationRun | undefined>;
  findByIdempotencyKey(campaignId: string, idempotencyKey: string): Promise<IDiscoveryOperationRun | undefined>;
  findRun(runId: string): Promise<IDiscoveryOperationRun | undefined>;
  listRuns(campaignId: string | undefined, offset: number, limit: number): Promise<IDiscoveryOperationRunPage>;
  saveRun(run: IDiscoveryOperationRun): Promise<void>;
  updateRunStatus(
    runId: string,
    status: DISCOVERY_OPERATION_RUN_STATUS,
    updatedAt: Date,
    failureMessage?: string,
  ): Promise<void>;
}

export interface IDiscoveryOperationRunPage {
  readonly items: readonly IDiscoveryOperationRun[];
  readonly total: number;
}
