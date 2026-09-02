import { gunzipSync } from 'node:zlib';

import {
  ACTOR_GATEWAY_SCHEMA_VERSION,
  ACTOR_REQUEST_STATUS,
} from '@scout/contracts';

import {
  IProviderRunReference,
  PROVIDER_RUN_STATUS,
} from '../../../domain/discovery/discovery-model.js';
import { IActorGatewayClientPort } from '../../../ports/outbound/actor-gateway-client.port.js';
import {
  DiscoveryProviderError,
  IDiscoveryProviderPort,
  IGetProviderRunStatusInput,
  IProviderLeadCandidate,
  IProviderResultPage,
  IReadProviderResultsInput,
  IStartProviderRunInput,
} from '../../../ports/outbound/discovery-provider.port.js';

const ACTOR_DEFINITION_ID = 'google-maps-search';
const ACTOR_REVISION = 'latest';
const CACHE_POLICY_REVISION = 'discovery-google-maps-v1';

export class ActorGatewayGoogleMapsProviderAdapter implements IDiscoveryProviderPort {
  public constructor(private readonly actorGatewayClient: IActorGatewayClientPort) {}

  public async getRunStatus(input: IGetProviderRunStatusInput): Promise<IProviderRunReference> {
    try {
      return toProviderRunReference(
        await this.actorGatewayClient.getRequestStatus(input.providerRunId),
      );
    } catch (error: unknown) {
      throw new DiscoveryProviderError(true, 'Actor Gateway status request failed', error);
    }
  }

  public async readProviderResults(input: IReadProviderResultsInput): Promise<IProviderResultPage> {
    try {
      const records = readArchiveRecords(await this.actorGatewayClient.getArchiveContent(input.datasetReference));
      const items = records
        .slice(input.offset, input.offset + input.limit)
        .map((record) => parseProviderItem(record))
        .filter((candidate): candidate is IProviderLeadCandidate => candidate !== null);

      return {
        items,
        nextOffset: input.offset + input.limit < records.length ? input.offset + input.limit : null,
      };
    } catch (error: unknown) {
      throw new DiscoveryProviderError(true, 'Actor Gateway archive retrieval failed', error);
    }
  }

  public async startProviderRun(input: IStartProviderRunInput): Promise<IProviderRunReference> {
    if (input.searchQueries.length === 0) {
      throw new Error('at least one search query is required');
    }

    try {
      return toProviderRunReference(await this.actorGatewayClient.resolveRequest({
        actorDefinitionId: ACTOR_DEFINITION_ID,
        actorRevision: ACTOR_REVISION,
        cachePolicyRevision: CACHE_POLICY_REVISION,
        canonicalInput: {
          includeWebResults: false,
          language: 'en',
          locationQuery: input.scopeId,
          maxCompetitorsToAnalyze: 0,
          maxCrawledPlacesPerSearch: Math.max(1, Math.floor(input.maximumItemCount / input.searchQueries.length)),
          maxImages: 0,
          maximumLeadsEnrichmentRecords: 0,
          scrapeContacts: false,
          scrapeDirectories: false,
          scrapePlaceDetailPage: false,
          scrapeSocialMediaProfiles: { facebooks: false, instagrams: false, tiktoks: false, twitters: false, youtubes: false },
          searchStringsArray: input.searchQueries,
        },
        correlationId: crypto.randomUUID(),
        requestedAt: new Date().toISOString(),
        schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
      }));
    } catch (error: unknown) {
      throw new DiscoveryProviderError(true, 'Actor Gateway request resolution failed', error);
    }
  }
}

function readArchiveRecords(content: Uint8Array): readonly unknown[] {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(gunzipSync(content)));

  if (!Array.isArray(parsed)) {
    throw new Error('Actor Gateway archive must contain a JSON record array');
  }

  return parsed;
}

function parseProviderItem(value: unknown): IProviderLeadCandidate | null {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    return null;
  }

  const record = new Map(Object.entries(value));
  const externalId = readFirstString(record, ['placeId', 'place_id', 'cid']);
  const name = readFirstString(record, ['title', 'name']);

  if (externalId === undefined || name === undefined) {
    return null;
  }

  const address = readFirstString(record, ['address']);
  const phoneNumber = readFirstString(record, ['phone', 'phoneNumber']);
  const websiteUrl = readFirstString(record, ['website', 'websiteUrl']);

  return { ...(address === undefined ? {} : { address }), externalId, name, ...(phoneNumber === undefined ? {} : { phoneNumber }), ...(websiteUrl === undefined ? {} : { websiteUrl }) };
}

function readFirstString(record: Map<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record.get(key);

    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function toProviderRunReference(status: { readonly archiveId?: string; readonly requestId: string; readonly status: ACTOR_REQUEST_STATUS }): IProviderRunReference {
  if (status.status === ACTOR_REQUEST_STATUS.FAILED) {
    return { providerRunId: status.requestId, status: PROVIDER_RUN_STATUS.FAILED };
  }
  if (status.status === ACTOR_REQUEST_STATUS.SUCCEEDED) {
    if (status.archiveId === undefined) {
      throw new Error('successful Actor Gateway request has no archive');
    }

    return { datasetReference: status.archiveId, providerRunId: status.requestId, status: PROVIDER_RUN_STATUS.SUCCEEDED };
  }

  return { providerRunId: status.requestId, status: status.status === ACTOR_REQUEST_STATUS.RUNNING ? PROVIDER_RUN_STATUS.RUNNING : PROVIDER_RUN_STATUS.PENDING };
}
