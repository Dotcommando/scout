import { ApifyClient } from 'apify-client';

import {
  ACTOR_PROVIDER_RUN_STATUS,
  ActorProviderError,
  IActorProviderPort,
  IActorProviderRun,
} from '../../../ports/outbound/actor-provider.port.js';

export class ApifyActorProviderAdapter implements IActorProviderPort {
  private readonly client: ApifyClient;

  public constructor(apiToken: string) {
    this.client = new ApifyClient({ token: apiToken });
  }

  public async getRun(providerRunId: string): Promise<IActorProviderRun> {
    try {
      return parseApifyRun(await this.client.run(providerRunId).get());
    } catch (error: unknown) {
      throw createApifyProviderError('get-run', error, { providerRunId });
    }
  }

  public async listDatasetRecords(
    datasetId: string,
    offset: number,
    limit: number,
  ): Promise<readonly unknown[]> {
    try {
      const page = await this.client.dataset(datasetId).listItems({ limit, offset });

      return page.items;
    } catch (error: unknown) {
      throw createApifyProviderError('list-dataset-records', error, {});
    }
  }

  public async startRun(
    actorId: string,
    input: Record<string, unknown>,
  ): Promise<IActorProviderRun> {
    try {
      return parseApifyRun(await this.client.actor(actorId).start(input));
    } catch (error: unknown) {
      throw createApifyProviderError('start-run', error, {});
    }
  }
}

function createApifyProviderError(
  operation: string,
  error: unknown,
  context: { readonly providerRunId?: string },
): ActorProviderError {
  const errorRecord = readErrorRecord(error);
  const statusCode = readOptionalNumber(errorRecord, 'statusCode');
  const providerCode = readOptionalString(errorRecord, 'type');

  return new ActorProviderError(
    operation,
    statusCode === undefined || statusCode === 408 || statusCode === 429 || statusCode >= 500,
    { ...context, ...(providerCode === undefined ? {} : { providerCode }), ...(statusCode === undefined ? {} : { statusCode }) },
    error,
  );
}

function readErrorRecord(value: unknown): Map<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? new Map(Object.entries(value))
    : new Map<string, unknown>();
}

function readOptionalNumber(record: Map<string, unknown>, key: string): number | undefined {
  const value = record.get(key);

  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

export class ApifyActorProviderContractError extends Error {
  public constructor(reason: string) {
    super(`Invalid Apify actor response: ${reason}`);
    this.name = 'ApifyActorProviderContractError';
  }
}

export function parseApifyRun(value: unknown): IActorProviderRun {
  const record = readRecord(value);
  const providerRunId = readNonEmptyString(record, 'id');
  const providerStatus = readNonEmptyString(record, 'status');
  const datasetId = readOptionalString(record, 'defaultDatasetId');

  return {
    ...(datasetId === undefined ? {} : { datasetId }),
    providerRunId,
    status: mapStatus(providerStatus),
  };
}

function mapStatus(status: string): ACTOR_PROVIDER_RUN_STATUS {
  if (status === 'READY') {
    return ACTOR_PROVIDER_RUN_STATUS.PENDING;
  }
  if (status === 'RUNNING') {
    return ACTOR_PROVIDER_RUN_STATUS.RUNNING;
  }
  if (status === 'SUCCEEDED') {
    return ACTOR_PROVIDER_RUN_STATUS.SUCCEEDED;
  }

  return ACTOR_PROVIDER_RUN_STATUS.FAILED;
}

function readNonEmptyString(record: Map<string, unknown>, key: string): string {
  const value = readOptionalString(record, key);

  if (value === undefined) {
    throw new ApifyActorProviderContractError(`${key} is required`);
  }

  return value;
}

function readOptionalString(
  record: Map<string, unknown>,
  key: string,
): string | undefined {
  const value = record.get(key);

  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readRecord(value: unknown): Map<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new ApifyActorProviderContractError('run must be an object');
  }

  return new Map(Object.entries(value));
}
