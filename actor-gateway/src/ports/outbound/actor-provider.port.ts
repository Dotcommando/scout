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

export interface IActorProviderFailureContext {
  readonly providerCode?: string;
  readonly providerRunId?: string;
  readonly retryAfterMilliseconds?: number;
  readonly statusCode?: number;
}

export class ActorProviderError extends Error {
  public constructor(
    public readonly operation: string,
    public readonly retryable: boolean,
    public readonly context: IActorProviderFailureContext,
    cause: unknown,
  ) {
    super(`Actor provider ${operation} failed`, { cause });
    this.name = 'ActorProviderError';
  }
}
