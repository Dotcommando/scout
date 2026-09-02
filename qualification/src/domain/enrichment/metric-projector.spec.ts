import {
  ENRICHMENT_METRIC_AVAILABILITY,
  ENRICHMENT_METRIC_KIND,
} from './enrichment-model.js';
import { projectSixMetrics } from './metric-projector.js';

describe('projectSixMetrics', () => {
  it('projects exactly six auditable metrics from one retained market snapshot', () => {
    const metrics = projectSixMetrics(
      'archive-1',
      {
        amenities: ['pool', 'restaurant', 'wifi'],
        externalId: 'place-1',
        price: '120',
        rawRecordIndex: 0,
        reviewVolume: 99,
      },
      [
        { amenities: [], externalId: 'place-1', price: '120', rawRecordIndex: 0, reviewVolume: 99 },
        { amenities: [], externalId: 'place-2', price: '100', rawRecordIndex: 1 },
        { amenities: [], externalId: 'place-3', price: '140', rawRecordIndex: 2 },
      ],
      ['pool', 'restaurant'],
    );

    expect(metrics).toHaveLength(6);
    expect(metrics.map((metric) => metric.kind).sort()).toEqual(
      Object.values(ENRICHMENT_METRIC_KIND).sort(),
    );
    expect(metrics.every((metric) => metric.availability === ENRICHMENT_METRIC_AVAILABILITY.AVAILABLE)).toBe(true);
    expect(metrics[0]?.evidence[0]?.archiveId).toBe('archive-1');
  });

  it('keeps unavailable inputs explicit instead of inventing zero values', () => {
    const metrics = projectSixMetrics('archive-1', null, [], ['pool']);

    expect(metrics.every((metric) => metric.availability === ENRICHMENT_METRIC_AVAILABILITY.UNAVAILABLE)).toBe(true);
    expect(metrics.every((metric) => metric.value === undefined)).toBe(true);
  });
});
