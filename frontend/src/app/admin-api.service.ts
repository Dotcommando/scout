import { Injectable } from '@angular/core';

import { readApiBaseUrl } from './runtime-configuration';

export enum ADMIN_TAB {
  DISCOVERY = 'discovery',
  QUALIFICATION = 'qualification',
}

export enum SORT_DIRECTION {
  ASC = 'asc',
  DESC = 'desc',
}

export enum DISCOVERY_RUN_STATUS {
  ACCEPTED = 'accepted',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RUNNING = 'running',
}

export interface IPage<TItem> {
  readonly items: readonly TItem[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface IConfiguration {
  readonly campaignId: string;
  readonly createdAt: string;
  readonly maximumProviderItemsPerRun?: number;
  readonly scopes: readonly IScope[];
  readonly version: number;
}

export interface IScope {
  readonly id: string;
  readonly label: string;
}

export interface IDiscoveryLead {
  readonly address?: string;
  readonly createdAt: string;
  readonly externalId: string;
  readonly leadId: string;
  readonly name: string;
  readonly phoneNumber?: string;
  readonly sourceKind: string;
  readonly websiteUrl?: string;
}

export interface IDiscoveryRun {
  readonly campaignId: string;
  readonly failureMessage?: string;
  readonly runId: string;
  readonly status: DISCOVERY_RUN_STATUS;
}

export interface IQualificationMetric {
  readonly availability: string;
  readonly kind: string;
  readonly value?: string;
}

export interface IQualificationLead {
  readonly createdAt: string;
  readonly decision?: {
    readonly decision: {
      readonly decision: string;
      readonly reasons: readonly { readonly code: string }[];
    };
  };
  readonly enrichment: { readonly metrics: readonly IQualificationMetric[] } | null;
  readonly enrichmentState: string;
  readonly lead: IDiscoveryLead;
  readonly processing: boolean;
}

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  public async getConfigurations(tab: ADMIN_TAB): Promise<IPage<IConfiguration>> {
    const response = await this.getJson(
      '/' + tab + '/configurations?offset=0&limit=100',
    );

    return parseConfigurationPage(response);
  }

  public async getDiscoveryLeads(
    campaignId: string,
    offset: number,
    sortBy: string,
    sortDirection: SORT_DIRECTION,
  ): Promise<IPage<IDiscoveryLead>> {
    const query = new URLSearchParams({
      campaignId,
      limit: '50',
      offset: String(offset),
      sortBy,
      sortDirection,
    });

    return parseDiscoveryLeadPage(await this.getJson('/discovery/leads?' + query.toString()));
  }

  public async getQualificationLeads(
    campaignId: string,
    offset: number,
    sortBy: string,
    sortDirection: SORT_DIRECTION,
  ): Promise<IPage<IQualificationLead>> {
    const query = new URLSearchParams({
      campaignId,
      limit: '50',
      offset: String(offset),
      profileVersion: '1',
      sortBy,
      sortDirection,
    });

    return parseQualificationLeadPage(
      await this.getJson('/qualification/leads?' + query.toString()),
    );
  }

  public async createConfiguration(tab: ADMIN_TAB, payload: unknown): Promise<void> {
    await this.request('/' + tab + '/configurations', 'POST', payload);
  }

  public async runDiscovery(campaignId: string, maximumProviderItems: number): Promise<IDiscoveryRun> {
    return parseDiscoveryRun(await this.request('/discovery/runs', 'POST', {
      campaignId,
      idempotencyKey: crypto.randomUUID(),
      maximumProviderItems,
    }));
  }

  public async getDiscoveryRun(runId: string): Promise<IDiscoveryRun> {
    return parseDiscoveryRun(await this.getJson('/discovery/runs/' + encodeURIComponent(runId)));
  }

  public async requalify(campaignId: string, leadId: string): Promise<void> {
    await this.request('/qualification/executions', 'POST', {
      campaignId,
      idempotencyKey: crypto.randomUUID(),
      leadId,
      profileVersion: 1,
    });
  }

  private async getJson(path: string): Promise<unknown> {
    return this.request(path, 'GET');
  }

  private async request(path: string, method: string, body?: unknown): Promise<unknown> {
    const response = await fetch(readApiBaseUrl() + path, {
      ...(body === undefined
        ? {}
        : {
          body: JSON.stringify(body),
        }),
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'X-Correlation-Id': crypto.randomUUID(),
      },
      method,
    });
    const payload: unknown = await response.json();

    if (!response.ok) {
      throw new Error(readErrorMessage(payload));
    }

    return payload;
  }
}

function parseConfigurationPage(input: unknown): IPage<IConfiguration> {
  return parsePage(input, parseConfiguration);
}

export function parseDiscoveryRun(input: unknown): IDiscoveryRun {
  const record = readRecord(input, 'Discovery run');
  const failureMessage = readOptionalString(record.failureMessage);

  return {
    campaignId: readString(record.campaignId, 'campaignId'),
    ...(failureMessage === undefined ? {} : { failureMessage }),
    runId: readString(record.runId, 'runId'),
    status: readDiscoveryRunStatus(record.status),
  };
}

function parseDiscoveryLeadPage(input: unknown): IPage<IDiscoveryLead> {
  return parsePage(input, (item) => {
    const record = readRecord(item, 'Discovery Lead');

    return {
      ...(readOptionalString(record.address) === undefined ? {} : { address: readOptionalString(record.address) }),
      createdAt: readString(record.createdAt, 'createdAt'),
      externalId: readString(record.externalId, 'externalId'),
      leadId: readString(record.leadId, 'leadId'),
      name: readString(record.name, 'name'),
      ...(readOptionalString(record.phoneNumber) === undefined ? {} : { phoneNumber: readOptionalString(record.phoneNumber) }),
      sourceKind: readString(record.sourceKind, 'sourceKind'),
      ...(readOptionalString(record.websiteUrl) === undefined ? {} : { websiteUrl: readOptionalString(record.websiteUrl) }),
    };
  });
}

function parseQualificationLeadPage(input: unknown): IPage<IQualificationLead> {
  return parsePage(input, (item) => {
    const record = readRecord(item, 'Qualification Lead');
    const lead = parseDiscoveryLead(readRecord(record.lead, 'lead'));
    const enrichment = record.enrichment === null
      ? null
      : parseEnrichment(readRecord(record.enrichment, 'enrichment'));

    return {
      createdAt: readString(record.createdAt, 'createdAt'),
      ...(record.decision === undefined ? {} : { decision: parseDecision(readRecord(record.decision, 'decision')) }),
      enrichment,
      enrichmentState: readString(record.enrichmentState, 'enrichmentState'),
      lead,
      processing: readBoolean(record.processing, 'processing'),
    };
  });
}

function parseConfiguration(input: unknown): IConfiguration {
  const record = readRecord(input, 'configuration');
  const rawScopes = Array.isArray(record.scopes) ? record.scopes : [];
  const limits = record.limits === undefined
    ? undefined
    : readRecord(record.limits, 'limits');

  return {
    campaignId: readString(record.campaignId, 'campaignId'),
    createdAt: readString(record.createdAt, 'createdAt'),
    ...(limits === undefined || typeof limits.maxProviderItemsPerRun !== 'number'
      ? {}
      : { maximumProviderItemsPerRun: limits.maxProviderItemsPerRun }),
    scopes: rawScopes.map((scope) => {
      const scopeRecord = readRecord(scope, 'scope');

      return {
        id: readString(scopeRecord.id, 'scope.id'),
        label: readString(scopeRecord.label, 'scope.label'),
      };
    }),
    version: readNumber(record.version, 'version'),
  };
}

function parseDiscoveryLead(record: Record<string, unknown>): IDiscoveryLead {
  return {
    ...(readOptionalString(record.address) === undefined ? {} : { address: readOptionalString(record.address) }),
    createdAt: readString(record.createdAt, 'lead.createdAt'),
    externalId: readString(record.externalId, 'lead.externalId'),
    leadId: readString(record.leadId, 'lead.leadId'),
    name: readString(record.name, 'lead.name'),
    ...(readOptionalString(record.phoneNumber) === undefined ? {} : { phoneNumber: readOptionalString(record.phoneNumber) }),
    sourceKind: readString(record.sourceKind, 'lead.sourceKind'),
    ...(readOptionalString(record.websiteUrl) === undefined ? {} : { websiteUrl: readOptionalString(record.websiteUrl) }),
  };
}

function parseEnrichment(record: Record<string, unknown>): { readonly metrics: readonly IQualificationMetric[] } {
  const rawMetrics = readArray(record.metrics, 'enrichment.metrics');

  return {
    metrics: rawMetrics.map((metric) => {
      const metricRecord = readRecord(metric, 'metric');

      return {
        availability: readString(metricRecord.availability, 'metric.availability'),
        kind: readString(metricRecord.kind, 'metric.kind'),
        ...(readOptionalString(metricRecord.value) === undefined ? {} : { value: readOptionalString(metricRecord.value) }),
      };
    }),
  };
}

function parseDecision(record: Record<string, unknown>): { readonly decision: { readonly decision: string; readonly reasons: readonly { readonly code: string }[] } } {
  const decision = readRecord(record.decision, 'decision.decision');
  const reasons = readArray(decision.reasons, 'decision.reasons');

  return {
    decision: {
      decision: readString(decision.decision, 'decision.decision'),
      reasons: reasons.map((reason) => {
        const reasonRecord = readRecord(reason, 'reason');

        return { code: readString(reasonRecord.code, 'reason.code') };
      }),
    },
  };
}

function parsePage<TItem>(input: unknown, parser: (item: unknown) => TItem): IPage<TItem> {
  const record = readRecord(input, 'page');

  return {
    items: readArray(record.items, 'items').map(parser),
    limit: readNumber(record.limit, 'limit'),
    offset: readNumber(record.offset, 'offset'),
    total: readNumber(record.total, 'total'),
  };
}

function readArray(value: unknown, fieldPath: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(fieldPath + ' must be an array');
  }

  return value;
}

function readBoolean(value: unknown, fieldPath: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(fieldPath + ' must be a boolean');
  }

  return value;
}

function readErrorMessage(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const message = Object.entries(value).find(([key]) => key === 'message')?.[1];

    return typeof message === 'string' ? message : 'Request failed';
  }

  return 'Request failed';
}

function readNumber(value: unknown, fieldPath: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(fieldPath + ' must be a number');
  }

  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readRecord(value: unknown, fieldPath: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(fieldPath + ' must be an object');
  }

  return Object.entries(value).reduce<Record<string, unknown>>(
    (record, [key, nestedValue]) => ({ ...record, [key]: nestedValue }),
    {},
  );
}

function readString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(fieldPath + ' must be a non-empty string');
  }

  return value;
}

function readDiscoveryRunStatus(value: unknown): DISCOVERY_RUN_STATUS {
  if (value === DISCOVERY_RUN_STATUS.ACCEPTED
    || value === DISCOVERY_RUN_STATUS.COMPLETED
    || value === DISCOVERY_RUN_STATUS.FAILED
    || value === DISCOVERY_RUN_STATUS.RUNNING) {
    return value;
  }

  throw new Error('status must be a supported Discovery run status');
}
