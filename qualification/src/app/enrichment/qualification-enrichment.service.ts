import { gunzipSync } from 'node:zlib';

import {
  ACTOR_GATEWAY_SCHEMA_VERSION,
  ACTOR_REQUEST_STATUS,
} from '@scout/contracts';

import { IMarketRecord, projectSixMetrics } from '../../domain/enrichment/metric-projector.js';
import { ILeadSnapshot } from '../../domain/qualification/qualification-model.js';
import { IGetQualificationEnrichmentSnapshotUseCase } from '../../ports/inbound/get-qualification-enrichment-snapshot.use-case.js';
import { IActorGatewayClientPort } from '../../ports/outbound/actor-gateway-client.port.js';
import { IQualificationEnrichmentConfigurationPort } from '../../ports/outbound/qualification-enrichment-configuration.port.js';
import { IQualificationEnrichmentSnapshotRepositoryPort } from '../../ports/outbound/qualification-enrichment-snapshot-repository.port.js';

const EXTRACTOR_REVISION = 'google-hotels-market-v1';

export class QualificationEnrichmentService implements IGetQualificationEnrichmentSnapshotUseCase {
  public constructor(
    private readonly actorGatewayClient: IActorGatewayClientPort,
    private readonly configuration: IQualificationEnrichmentConfigurationPort,
    private readonly snapshotRepository: IQualificationEnrichmentSnapshotRepositoryPort,
  ) {}

  public async getEnrichmentSnapshot(
    campaignId: string,
    leadId: string,
    profileVersion: number,
  ) {
    return this.snapshotRepository.findSnapshot(campaignId, leadId, profileVersion);
  }

  public async enrichLead(
    campaignId: string,
    lead: ILeadSnapshot,
    profileVersion: number,
    correlationId: string,
    occurredAt: Date,
  ): Promise<void> {
    const existing = await this.snapshotRepository.findSnapshot(
      campaignId,
      lead.leadId,
      profileVersion,
    );

    if (existing !== null) {
      return;
    }

    const configuration = this.configuration.getConfiguration(campaignId);

    if (!configuration.enabled) {
      return;
    }

    const request = await this.actorGatewayClient.resolveRequest({
      actorDefinitionId: configuration.actorDefinitionId,
      actorRevision: configuration.actorRevision,
      cachePolicyRevision: configuration.cachePolicyRevision,
      canonicalInput: {
        currency: configuration.currency,
        guests: configuration.guests,
        locale: configuration.locale,
        marketQuery: createMarketQuery(lead),
        nights: configuration.nights,
      },
      correlationId,
      requestedAt: occurredAt.toISOString(),
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
    });

    if (request.status === ACTOR_REQUEST_STATUS.FAILED) {
      throw new Error(`Actor Gateway enrichment request failed: ${request.requestId}`);
    }
    if (request.status !== ACTOR_REQUEST_STATUS.SUCCEEDED || request.archiveId === undefined) {
      throw new EnrichmentPendingError(request.requestId);
    }

    const records = parseMarketRecords(
      await this.actorGatewayClient.getArchiveContent(request.archiveId),
    );
    const target = records.find((record) => record.externalId === lead.externalId) ?? null;
    const metrics = projectSixMetrics(
      request.archiveId,
      target,
      records,
      configuration.amenityCatalogue,
    );

    await this.snapshotRepository.saveSnapshot({
      actorDefinitionId: configuration.actorDefinitionId,
      actorRevision: configuration.actorRevision,
      archiveId: request.archiveId,
      campaignId,
      extractorRevision: EXTRACTOR_REVISION,
      leadId: lead.leadId,
      metrics,
      profileVersion,
      projectedAt: occurredAt,
      requestId: request.requestId,
      stayContext: {
        currency: configuration.currency,
        guests: String(configuration.guests),
        locale: configuration.locale,
        nights: String(configuration.nights),
      },
    });
  }
}

export class EnrichmentPendingError extends Error {
  public constructor(public readonly requestId: string) {
    super(`Actor Gateway enrichment request is pending: ${requestId}`);
    this.name = 'EnrichmentPendingError';
  }
}

function createMarketQuery(lead: ILeadSnapshot): string {
  return [lead.name, lead.address].filter((value): value is string => value !== undefined).join(', ');
}

function parseMarketRecords(content: Uint8Array): readonly IMarketRecord[] {
  const decoded: unknown = JSON.parse(new TextDecoder().decode(gunzipSync(content)));

  if (!Array.isArray(decoded)) {
    throw new Error('Actor Gateway archive must contain a JSON record array');
  }

  return decoded.map((value, rawRecordIndex) => parseMarketRecord(value, rawRecordIndex));
}

function parseMarketRecord(value: unknown, rawRecordIndex: number): IMarketRecord {
  const record = value !== null && !Array.isArray(value) && typeof value === 'object'
    ? new Map(Object.entries(value))
    : new Map<string, unknown>();
  const amenities = readStringArray(record, 'amenities');

  return {
    amenities,
    ...(readFirstString(record, ['placeId', 'place_id', 'googlePlaceId']) === undefined
      ? {}
      : { externalId: readFirstString(record, ['placeId', 'place_id', 'googlePlaceId']) }),
    ...(readPrice(record) === undefined ? {} : { price: readPrice(record) }),
    rawRecordIndex,
    ...(readFirstNumber(record, ['reviewCount', 'reviewsCount', 'reviewVolume']) === undefined
      ? {}
      : { reviewVolume: readFirstNumber(record, ['reviewCount', 'reviewsCount', 'reviewVolume']) }),
  };
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

function readFirstNumber(record: Map<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record.get(key);

    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      return value;
    }
  }

  return undefined;
}

function readPrice(record: Map<string, unknown>): string | undefined {
  const value = record.get('price') ?? record.get('rate') ?? record.get('nightlyRate');

  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value.toString();
  }
  if (typeof value === 'string' && /^[0-9]+(?:\.[0-9]+)?$/.test(value) && Number(value) > 0) {
    return value;
  }

  return undefined;
}

function readStringArray(record: Map<string, unknown>, key: string): readonly string[] {
  const value = record.get(key);

  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.toLowerCase())
    : [];
}
