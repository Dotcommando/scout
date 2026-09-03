export enum ENRICHMENT_METRIC_AVAILABILITY {
  AVAILABLE = 'AVAILABLE',
  NOT_APPLICABLE = 'NOT_APPLICABLE',
  UNAVAILABLE = 'UNAVAILABLE',
}

export const ENRICHMENT_METRIC_AVAILABILITY_ARRAY = Object.values(
  ENRICHMENT_METRIC_AVAILABILITY,
);

export enum ENRICHMENT_METRIC_KIND {
  FULL_SERVICE_HOTEL_SIGNAL = 'FULL_SERVICE_HOTEL_SIGNAL',
  MARKET_PRICE_POSITION = 'MARKET_PRICE_POSITION',
  MARKET_VALUE_PROXY = 'MARKET_VALUE_PROXY',
  MONETISABLE_ASSET_COUNT = 'MONETISABLE_ASSET_COUNT',
  PUBLIC_ADR = 'PUBLIC_ADR',
  REVIEW_VOLUME = 'REVIEW_VOLUME',
}

export const ENRICHMENT_METRIC_KIND_ARRAY = Object.values(ENRICHMENT_METRIC_KIND);

export enum ENRICHMENT_STATE {
  AVAILABLE = 'available',
  FAILED = 'failed',
  PENDING = 'pending',
  UNAVAILABLE = 'unavailable',
}

export const ENRICHMENT_STATE_ARRAY = Object.values(ENRICHMENT_STATE);

export enum FULL_SERVICE_HOTEL_SIGNAL {
  FULL_SERVICE = 'FULL_SERVICE',
  LIMITED_SERVICE = 'LIMITED_SERVICE',
  NO_SIGNAL = 'NO_SIGNAL',
}

export interface IMetricEvidence {
  readonly archiveId: string;
  readonly jsonPointer: string;
  readonly rawRecordIndex: number;
}

export interface IQualificationEnrichmentMetric {
  readonly availability: ENRICHMENT_METRIC_AVAILABILITY;
  readonly calculationContext: Readonly<Record<string, string>>;
  readonly evidence: readonly IMetricEvidence[];
  readonly kind: ENRICHMENT_METRIC_KIND;
  readonly value?: string;
}

export interface IQualificationEnrichmentSnapshot {
  readonly actorDefinitionId: string;
  readonly actorRevision: string;
  readonly archiveId: string;
  readonly campaignId: string;
  readonly extractorRevision: string;
  readonly leadId: string;
  readonly metrics: readonly IQualificationEnrichmentMetric[];
  readonly profileVersion: number;
  readonly projectedAt: Date;
  readonly requestId: string;
  readonly stayContext: Readonly<Record<string, string>>;
}
