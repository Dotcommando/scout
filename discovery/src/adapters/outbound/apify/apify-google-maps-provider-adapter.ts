import { ApifyClient } from 'apify-client';

import {
  IProviderRunReference,
  PROVIDER_RUN_STATUS,
} from '../../../domain/discovery/discovery-model.js';
import {
  IDiscoveryProviderPort,
  IGetProviderRunStatusInput,
  IProviderLeadCandidate,
  IProviderResultPage,
  IReadProviderResultsInput,
  IStartProviderRunInput,
} from '../../../ports/outbound/discovery-provider.port.js';
import { DiscoveryRuntimeConfiguration } from '../../inbound/bootstrap/discovery-runtime-configuration.js';
import { DiscoveryCampaignConfiguration } from '../../inbound/configuration/discovery-campaign-configuration.js';

export class ApifyGoogleMapsProviderAdapter implements IDiscoveryProviderPort {
  private readonly actorId: string;
  private readonly client: ApifyClient;

  public constructor(
    runtimeConfiguration: DiscoveryRuntimeConfiguration,
    campaignConfiguration: DiscoveryCampaignConfiguration,
  ) {
    this.actorId = campaignConfiguration.value.source.actorId;
    this.client = new ApifyClient({
      token: runtimeConfiguration.apifyApiToken,
    });
  }

  public async getRunStatus(
    input: IGetProviderRunStatusInput,
  ): Promise<IProviderRunReference> {
    try {
      const run = await this.client.run(input.providerRunId).get();

      return parseRun(run);
    } catch (error: unknown) {
      throw createApifyProviderError('get-run-status', error, {
        providerRunId: input.providerRunId,
      });
    }
  }

  public async readProviderResults(
    input: IReadProviderResultsInput,
  ): Promise<IProviderResultPage> {
    try {
      const page = await this.client.dataset(input.datasetReference).listItems({
        limit: input.limit,
        offset: input.offset,
      });
      const itemCount = page.items.length;

      return {
        items: page.items.map((item) => parseProviderItem(item)),
        nextOffset: itemCount < input.limit ? null : input.offset + itemCount,
      };
    } catch (error: unknown) {
      throw createApifyProviderError('read-provider-results', error, {
        datasetReference: input.datasetReference,
        offset: input.offset,
      });
    }
  }

  public async startProviderRun(
    input: IStartProviderRunInput,
  ): Promise<IProviderRunReference> {
    if (input.searchQueries.length === 0) {
      throw new Error('at least one search query is required');
    }

    const maximumPerSearch = Math.floor(
      input.maximumItemCount / input.searchQueries.length,
    );

    if (maximumPerSearch < 1) {
      throw new Error('maximumItemCount must allow at least one result per query');
    }

    try {
      const run = await this.client.actor(this.actorId).start({
        includeWebResults: false,
        language: 'en',
        locationQuery: input.scopeId,
        maxCompetitorsToAnalyze: 0,
        maxCrawledPlacesPerSearch: maximumPerSearch,
        maxImages: 0,
        maximumLeadsEnrichmentRecords: 0,
        scrapeContacts: false,
        scrapeDirectories: false,
        scrapePlaceDetailPage: false,
        scrapeSocialMediaProfiles: {
          facebooks: false,
          instagrams: false,
          tiktoks: false,
          twitters: false,
          youtubes: false,
        },
        searchStringsArray: input.searchQueries,
      });

      return parseRun(run);
    } catch (error: unknown) {
      throw createApifyProviderError('start-provider-run', error, {
        actorId: this.actorId,
        maximumItemCount: input.maximumItemCount,
        scopeId: input.scopeId,
      });
    }
  }
}

export interface IApifyProviderErrorContext {
  readonly actorId?: string;
  readonly datasetReference?: string;
  readonly maximumItemCount?: number;
  readonly offset?: number;
  readonly providerCode?: string;
  readonly providerRunId?: string;
  readonly scopeId?: string;
  readonly statusCode?: number;
}

export class ApifyProviderError extends Error {
  public constructor(
    public readonly operation: string,
    public readonly retryable: boolean,
    public readonly context: IApifyProviderErrorContext,
    cause: unknown,
  ) {
    super(`Apify ${operation} failed`, { cause });
    this.name = 'ApifyProviderError';
  }
}

export class ApifyProviderContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ApifyProviderContractError';
  }
}

export function parseProviderItem(value: unknown): IProviderLeadCandidate {
  const record = requireRecord(value, 'dataset item');
  const externalId = readFirstString(record, ['placeId', 'place_id', 'cid']);
  const name = readFirstString(record, ['title', 'name']);
  const address = readFirstString(record, ['address']);
  const phoneNumber = readFirstString(record, ['phone', 'phoneNumber']);
  const websiteUrl = readFirstString(record, ['website', 'websiteUrl']);

  if (externalId === undefined || name === undefined) {
    throw new ApifyProviderContractError(
      'dataset item must contain a stable place identifier and name',
    );
  }

  return {
    ...(address === undefined ? {} : { address }),
    externalId,
    name,
    ...(phoneNumber === undefined ? {} : { phoneNumber }),
    ...(websiteUrl === undefined ? {} : { websiteUrl }),
  };
}

export function parseRun(value: unknown): IProviderRunReference {
  const record = requireRecord(value, 'Actor run');
  const providerRunId = readRequiredString(record, 'id', 'Actor run');
  const status = mapProviderRunStatus(
    readRequiredString(record, 'status', 'Actor run'),
  );
  const datasetReference = readFirstString(record, ['defaultDatasetId']);

  return {
    ...(datasetReference === undefined ? {} : { datasetReference }),
    providerRunId,
    status,
  };
}

function mapProviderRunStatus(status: string): PROVIDER_RUN_STATUS {
  if (status === 'READY') {
    return PROVIDER_RUN_STATUS.PENDING;
  }
  if (status === 'RUNNING') {
    return PROVIDER_RUN_STATUS.RUNNING;
  }
  if (status === 'SUCCEEDED') {
    return PROVIDER_RUN_STATUS.SUCCEEDED;
  }

  return PROVIDER_RUN_STATUS.FAILED;
}

function readFirstString(
  record: Map<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record.get(key);

    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function readRequiredString(
  record: Map<string, unknown>,
  key: string,
  context: string,
): string {
  const value = readFirstString(record, [key]);

  if (value === undefined) {
    throw new Error(`${context} must contain ${key}`);
  }

  return value;
}

function requireRecord(value: unknown, context: string): Map<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new ApifyProviderContractError(`${context} must be an object`);
  }

  return new Map(Object.entries(value));
}

function createApifyProviderError(
  operation: string,
  error: unknown,
  context: IApifyProviderErrorContext,
): ApifyProviderError {
  const providerContext = readProviderErrorContext(error);

  return new ApifyProviderError(
    operation,
    isRetryable(providerContext.statusCode),
    {
      ...context,
      ...(providerContext.providerCode === undefined
        ? {}
        : { providerCode: providerContext.providerCode }),
      ...(providerContext.statusCode === undefined
        ? {}
        : { statusCode: providerContext.statusCode }),
    },
    error,
  );
}

function readProviderErrorContext(error: unknown): IApifyProviderErrorContext {
  if (error === null || Array.isArray(error) || typeof error !== 'object') {
    return {};
  }

  const record = new Map(Object.entries(error));
  const statusCode = record.get('statusCode');
  const providerCode = readFirstString(record, ['code', 'type']);

  return {
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(typeof statusCode === 'number' && Number.isSafeInteger(statusCode)
      ? { statusCode }
      : {}),
  };
}

function isRetryable(statusCode: number | undefined): boolean {
  return statusCode === undefined || statusCode === 408 || statusCode === 429 || statusCode >= 500;
}
