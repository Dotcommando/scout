export enum DISCOVERED_LEAD_EVENT_TYPE {
  DISCOVERED_LEAD = 'DISCOVERED_LEAD',
}

export enum DISCOVERED_LEAD_SCHEMA_VERSION {
  V1 = 1,
}

export interface IDiscoveredLeadSnapshot {
  readonly address?: string;
  readonly externalId: string;
  readonly leadId: string;
  readonly name: string;
  readonly phoneNumber?: string;
  readonly sourceKind: string;
  readonly websiteUrl?: string;
}

export interface IDiscoveredLeadEvent {
  readonly campaignId: string;
  readonly correlationId: string;
  readonly eventId: string;
  readonly eventType: DISCOVERED_LEAD_EVENT_TYPE;
  readonly lead: IDiscoveredLeadSnapshot;
  readonly occurredAt: string;
  readonly schemaVersion: DISCOVERED_LEAD_SCHEMA_VERSION;
}

export class DiscoveredLeadEventValidationError extends Error {
  public constructor(
    public readonly fieldPath: string,
    reason: string,
  ) {
    super(`Invalid discovered-lead event: ${fieldPath}: ${reason}`);
    this.name = 'DiscoveredLeadEventValidationError';
  }
}

export function parseDiscoveredLeadEvent(input: unknown): IDiscoveredLeadEvent {
  const event = readRecord(input, 'event');
  const schemaVersion = readSchemaVersion(event.schemaVersion);

  if (event.eventType !== DISCOVERED_LEAD_EVENT_TYPE.DISCOVERED_LEAD) {
    throw new DiscoveredLeadEventValidationError(
      'eventType',
      `must equal ${DISCOVERED_LEAD_EVENT_TYPE.DISCOVERED_LEAD}`,
    );
  }

  return {
    campaignId: readNonEmptyString(event.campaignId, 'campaignId'),
    correlationId: readNonEmptyString(event.correlationId, 'correlationId'),
    eventId: readNonEmptyString(event.eventId, 'eventId'),
    eventType: DISCOVERED_LEAD_EVENT_TYPE.DISCOVERED_LEAD,
    lead: parseLeadSnapshot(event.lead),
    occurredAt: readOccurredAt(event.occurredAt),
    schemaVersion,
  };
}

export function serializeDiscoveredLeadEvent(
  event: IDiscoveredLeadEvent,
): string {
  return JSON.stringify(parseDiscoveredLeadEvent(event));
}

function parseLeadSnapshot(input: unknown): IDiscoveredLeadSnapshot {
  const lead = readRecord(input, 'lead');

  return {
    ...(lead.address === undefined
      ? {}
      : { address: readNonEmptyString(lead.address, 'lead.address') }),
    externalId: readNonEmptyString(lead.externalId, 'lead.externalId'),
    leadId: readNonEmptyString(lead.leadId, 'lead.leadId'),
    name: readNonEmptyString(lead.name, 'lead.name'),
    ...(lead.phoneNumber === undefined
      ? {}
      : { phoneNumber: readNonEmptyString(lead.phoneNumber, 'lead.phoneNumber') }),
    sourceKind: readNonEmptyString(lead.sourceKind, 'lead.sourceKind'),
    ...(lead.websiteUrl === undefined
      ? {}
      : { websiteUrl: readNonEmptyString(lead.websiteUrl, 'lead.websiteUrl') }),
  };
}

function readOccurredAt(value: unknown): string {
  const occurredAt = readNonEmptyString(value, 'occurredAt');

  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new DiscoveredLeadEventValidationError(
      'occurredAt',
      'must be a valid ISO-8601 timestamp',
    );
  }

  return occurredAt;
}

function readSchemaVersion(
  value: unknown,
): DISCOVERED_LEAD_SCHEMA_VERSION {
  if (value === DISCOVERED_LEAD_SCHEMA_VERSION.V1) {
    return DISCOVERED_LEAD_SCHEMA_VERSION.V1;
  }

  throw new DiscoveredLeadEventValidationError(
    'schemaVersion',
    `must equal ${DISCOVERED_LEAD_SCHEMA_VERSION.V1}`,
  );
}

function readNonEmptyString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DiscoveredLeadEventValidationError(
      fieldPath,
      'must be a non-empty string',
    );
  }

  return value;
}

function readRecord(value: unknown, fieldPath: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new DiscoveredLeadEventValidationError(fieldPath, 'must be an object');
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
