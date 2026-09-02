import {
  DISCOVERED_LEAD_EVENT_TYPE,
  DISCOVERED_LEAD_SCHEMA_VERSION,
  DiscoveredLeadEventValidationError,
  parseDiscoveredLeadEvent,
  serializeDiscoveredLeadEvent,
} from './discovered-lead-event.js';

describe('discovered lead event contract', () => {
  it('serializes and parses a valid provider-neutral event', () => {
    const serialized = serializeDiscoveredLeadEvent({
      campaignId: 'independent-properties-gb',
      correlationId: 'correlation-1',
      eventId: 'output-1',
      eventType: DISCOVERED_LEAD_EVENT_TYPE.DISCOVERED_LEAD,
      lead: {
        externalId: 'place-1',
        leadId: 'lead-1',
        name: 'Example Property',
        sourceKind: 'google-maps',
      },
      occurredAt: '2026-09-02T10:00:00.000Z',
      schemaVersion: DISCOVERED_LEAD_SCHEMA_VERSION.V1,
    });

    expect(parseDiscoveredLeadEvent(JSON.parse(serialized))).toEqual({
      campaignId: 'independent-properties-gb',
      correlationId: 'correlation-1',
      eventId: 'output-1',
      eventType: DISCOVERED_LEAD_EVENT_TYPE.DISCOVERED_LEAD,
      lead: {
        externalId: 'place-1',
        leadId: 'lead-1',
        name: 'Example Property',
        sourceKind: 'google-maps',
      },
      occurredAt: '2026-09-02T10:00:00.000Z',
      schemaVersion: DISCOVERED_LEAD_SCHEMA_VERSION.V1,
    });
  });

  it('rejects an event with a missing required field', () => {
    expect(() =>
      parseDiscoveredLeadEvent({
        campaignId: 'campaign-1',
        correlationId: 'correlation-1',
        eventType: DISCOVERED_LEAD_EVENT_TYPE.DISCOVERED_LEAD,
        lead: {},
        occurredAt: '2026-09-02T10:00:00.000Z',
        schemaVersion: DISCOVERED_LEAD_SCHEMA_VERSION.V1,
      }),
    ).toThrow(DiscoveredLeadEventValidationError);
  });

  it('rejects an unknown schema version', () => {
    expect(() =>
      parseDiscoveredLeadEvent({
        campaignId: 'campaign-1',
        correlationId: 'correlation-1',
        eventId: 'event-1',
        eventType: DISCOVERED_LEAD_EVENT_TYPE.DISCOVERED_LEAD,
        lead: {
          externalId: 'external-1',
          leadId: 'lead-1',
          name: 'Example',
          sourceKind: 'source',
        },
        occurredAt: '2026-09-02T10:00:00.000Z',
        schemaVersion: 2,
      }),
    ).toThrow(/schemaVersion/);
  });

  it('rejects malformed events', () => {
    expect(() => parseDiscoveredLeadEvent('not-an-event')).toThrow(
      /event: must be an object/,
    );
  });
});
