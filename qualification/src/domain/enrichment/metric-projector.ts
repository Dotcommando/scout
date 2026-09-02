import {
  ENRICHMENT_METRIC_AVAILABILITY,
  ENRICHMENT_METRIC_KIND,
  FULL_SERVICE_HOTEL_SIGNAL,
  IMetricEvidence,
  IQualificationEnrichmentMetric,
} from './enrichment-model.js';

export interface IMarketRecord {
  readonly amenities: readonly string[];
  readonly externalId?: string;
  readonly price?: string;
  readonly rawRecordIndex: number;
  readonly reviewVolume?: number;
}

export function projectSixMetrics(
  archiveId: string,
  target: IMarketRecord | null,
  marketRecords: readonly IMarketRecord[],
  amenityCatalogue: readonly string[],
): readonly IQualificationEnrichmentMetric[] {
  const targetEvidence = target === null ? [] : [createEvidence(archiveId, target)];
  const adr = target?.price;
  const reviewVolume = target?.reviewVolume;
  const configuredAmenities = target === null
    ? []
    : target.amenities.filter((amenity) => amenityCatalogue.includes(amenity));
  const comparablePrices = marketRecords
    .map((record) => record.price)
    .filter((price): price is string => price !== undefined)
    .map((price) => Number(price))
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((left, right) => left - right);
  const median = getMedian(comparablePrices);

  return [
    createMetric(ENRICHMENT_METRIC_KIND.PUBLIC_ADR, adr, targetEvidence, {}),
    createMetric(
      ENRICHMENT_METRIC_KIND.REVIEW_VOLUME,
      reviewVolume === undefined ? undefined : String(reviewVolume),
      targetEvidence,
      {},
    ),
    createMetric(
      ENRICHMENT_METRIC_KIND.MARKET_PRICE_POSITION,
      adr === undefined || median === undefined ? undefined : divideDecimals(adr, median),
      targetEvidence,
      median === undefined ? {} : { comparablePriceCount: String(comparablePrices.length), median },
    ),
    createMetric(
      ENRICHMENT_METRIC_KIND.MONETISABLE_ASSET_COUNT,
      target === null ? undefined : String(configuredAmenities.length),
      targetEvidence,
      { amenityCatalogueRevision: 'v1' },
    ),
    createMetric(
      ENRICHMENT_METRIC_KIND.FULL_SERVICE_HOTEL_SIGNAL,
      target === null ? undefined : getServiceSignal(configuredAmenities.length),
      targetEvidence,
      { amenityCatalogueRevision: 'v1' },
    ),
    createMetric(
      ENRICHMENT_METRIC_KIND.MARKET_VALUE_PROXY,
      adr === undefined || reviewVolume === undefined ? undefined : createMarketValueProxy(adr, reviewVolume),
      targetEvidence,
      { formula: 'publicAdr*log10(reviewVolume+1)', rounding: '6-decimal-places' },
    ),
  ];
}

function createMetric(
  kind: ENRICHMENT_METRIC_KIND,
  value: string | undefined,
  evidence: readonly IMetricEvidence[],
  calculationContext: Readonly<Record<string, string>>,
): IQualificationEnrichmentMetric {
  return {
    availability: value === undefined
      ? ENRICHMENT_METRIC_AVAILABILITY.UNAVAILABLE
      : ENRICHMENT_METRIC_AVAILABILITY.AVAILABLE,
    calculationContext,
    evidence,
    kind,
    ...(value === undefined ? {} : { value }),
  };
}

function createEvidence(archiveId: string, record: IMarketRecord): IMetricEvidence {
  return { archiveId, jsonPointer: '/records', rawRecordIndex: record.rawRecordIndex };
}

function getMedian(values: readonly number[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const middle = Math.floor(values.length / 2);
  const value = values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];

  return value.toFixed(6);
}

function divideDecimals(left: string, right: string): string {
  const divisor = Number(right);
  const dividend = Number(left);

  return (dividend / divisor).toFixed(6);
}

function createMarketValueProxy(adr: string, reviewVolume: number): string {
  return (Number(adr) * Math.log10(reviewVolume + 1)).toFixed(6);
}

function getServiceSignal(amenityCount: number): FULL_SERVICE_HOTEL_SIGNAL {
  if (amenityCount >= 3) {
    return FULL_SERVICE_HOTEL_SIGNAL.FULL_SERVICE;
  }

  return amenityCount > 0
    ? FULL_SERVICE_HOTEL_SIGNAL.LIMITED_SERVICE
    : FULL_SERVICE_HOTEL_SIGNAL.NO_SIGNAL;
}
