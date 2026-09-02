import {
  DISCOVERED_LEAD_EVENT_TYPE,
  DISCOVERED_LEAD_SCHEMA_VERSION,
  IDiscoveredLeadEvent,
} from '@scout/contracts';

import {
  DISCOVERY_SOURCE_KIND,
  Lead,
} from '../../domain/discovery/discovery-model.js';

export const DISCOVERY_OUTPUT_SCHEMA_VERSION = 1;

export interface IDiscoveryOutputLeadSnapshot {
  readonly address?: string;
  readonly externalId: string;
  readonly leadId: string;
  readonly name: string;
  readonly phoneNumber?: string;
  readonly sourceKind: DISCOVERY_SOURCE_KIND;
  readonly websiteUrl?: string;
}

export interface IDiscoveryOutputPayload {
  readonly campaignId: string;
  readonly correlationId: string;
  readonly eventId: string;
  readonly lead: IDiscoveryOutputLeadSnapshot;
  readonly occurredAt: Date;
  readonly schemaVersion: number;
}

export interface ICreateDiscoveryOutputPayloadInput {
  readonly campaignId: string;
  readonly correlationId: string;
  readonly lead: Lead;
  readonly occurredAt: Date;
  readonly outputId: string;
}

export function createDiscoveryOutputPayload(
  input: ICreateDiscoveryOutputPayloadInput,
): IDiscoveryOutputPayload {
  return {
    campaignId: input.campaignId,
    correlationId: input.correlationId,
    eventId: input.outputId,
    lead: {
      ...(input.lead.details.address === undefined
        ? {}
        : { address: input.lead.details.address }),
      externalId: input.lead.sourceIdentity.externalId,
      leadId: input.lead.leadId,
      name: input.lead.details.name,
      ...(input.lead.details.phoneNumber === undefined
        ? {}
        : { phoneNumber: input.lead.details.phoneNumber }),
      sourceKind: input.lead.sourceIdentity.sourceKind,
      ...(input.lead.details.websiteUrl === undefined
        ? {}
        : { websiteUrl: input.lead.details.websiteUrl }),
    },
    occurredAt: input.occurredAt,
    schemaVersion: DISCOVERY_OUTPUT_SCHEMA_VERSION,
  };
}

export function toDiscoveredLeadEvent(
  payload: IDiscoveryOutputPayload,
): IDiscoveredLeadEvent {
  if (payload.schemaVersion !== DISCOVERED_LEAD_SCHEMA_VERSION.V1) {
    throw new Error(`unsupported discovery output schema version ${payload.schemaVersion}`);
  }

  return {
    campaignId: payload.campaignId,
    correlationId: payload.correlationId,
    eventId: payload.eventId,
    eventType: DISCOVERED_LEAD_EVENT_TYPE.DISCOVERED_LEAD,
    lead: {
      ...(payload.lead.address === undefined
        ? {}
        : { address: payload.lead.address }),
      externalId: payload.lead.externalId,
      leadId: payload.lead.leadId,
      name: payload.lead.name,
      ...(payload.lead.phoneNumber === undefined
        ? {}
        : { phoneNumber: payload.lead.phoneNumber }),
      sourceKind: payload.lead.sourceKind,
      ...(payload.lead.websiteUrl === undefined
        ? {}
        : { websiteUrl: payload.lead.websiteUrl }),
    },
    occurredAt: payload.occurredAt.toISOString(),
    schemaVersion: DISCOVERED_LEAD_SCHEMA_VERSION.V1,
  };
}
