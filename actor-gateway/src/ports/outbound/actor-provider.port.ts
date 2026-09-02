export enum ACTOR_PROVIDER_RUN_STATUS {
  FAILED = 'FAILED',
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
}

export interface IActorProviderRun {
  readonly datasetId?: string;
  readonly providerRunId: string;
  readonly status: ACTOR_PROVIDER_RUN_STATUS;
}

export interface IActorProviderPort {
  getRun(providerRunId: string): Promise<IActorProviderRun>;
  listDatasetRecords(
    datasetId: string,
    offset: number,
    limit: number,
  ): Promise<readonly unknown[]>;
  startRun(
    actorId: string,
    input: Record<string, unknown>,
  ): Promise<IActorProviderRun>;
}
