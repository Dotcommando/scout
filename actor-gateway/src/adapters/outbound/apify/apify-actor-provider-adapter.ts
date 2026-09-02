import { ApifyClient } from 'apify-client';

import {
  ACTOR_PROVIDER_RUN_STATUS,
  IActorProviderPort,
  IActorProviderRun,
} from '../../../ports/outbound/actor-provider.port.js';

export class ApifyActorProviderAdapter implements IActorProviderPort {
  private readonly client: ApifyClient;

  public constructor(apiToken: string) {
    this.client = new ApifyClient({ token: apiToken });
  }

  public async getRun(providerRunId: string): Promise<IActorProviderRun> {
    return parseApifyRun(await this.client.run(providerRunId).get());
  }

  public async listDatasetRecords(
    datasetId: string,
    offset: number,
    limit: number,
  ): Promise<readonly unknown[]> {
    const page = await this.client.dataset(datasetId).listItems({ limit, offset });

    return page.items;
  }

  public async startRun(
    actorId: string,
    input: Record<string, unknown>,
  ): Promise<IActorProviderRun> {
    return parseApifyRun(await this.client.actor(actorId).start(input));
  }
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
