import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import {
  ENRICHMENT_METRIC_AVAILABILITY,
  ENRICHMENT_METRIC_KIND,
  ENRICHMENT_STATE,
  FULL_SERVICE_HOTEL_SIGNAL,
  IQualificationEnrichmentSnapshot,
} from '../../../domain/enrichment/enrichment-model.js';
import { QUALIFICATION_DECISION } from '../../../domain/qualification/qualification-model.js';
import { IQualificationDecisionRecord } from '../../../ports/outbound/qualification-decision-repository.port.js';
import { IQualificationInboxRecord } from '../../../ports/outbound/qualification-inbox-repository.port.js';
import {
  IQualificationExecutionView,
  IQualificationLeadListInput,
  IQualificationLeadListItem,
  IQualificationLeadListPage,
  IQualificationLeadPage,
  IQualificationLeadView,
  IQualificationReadModelPort,
  IQualificationStatusCounts,
  QUALIFICATION_LEAD_SORT_BY,
  QUALIFICATION_LEAD_SORT_DIRECTION,
} from '../../../ports/outbound/qualification-read-model.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

@Injectable()
export class MongoQualificationReadModel
  implements IQualificationReadModelPort, OnModuleInit {
  private readonly decisions: Collection<IQualificationDecisionRecord>;
  private readonly enrichments: Collection<IQualificationEnrichmentSnapshot>;
  private readonly executions: Collection<IQualificationExecutionView>;
  private readonly inbox: Collection<IQualificationInboxRecord>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    const database = mongoDatabaseClient.getDatabase();

    this.decisions = database.collection('qualification_decisions');
    this.enrichments = database.collection('qualification_enrichment_snapshots');
    this.executions = database.collection('qualification_executions');
    this.inbox = database.collection('qualification_inbox');
  }

  public async onModuleInit(): Promise<void> {
    await Promise.all([
      this.inbox.createIndex(
        { campaignId: 1, receivedAt: -1, 'lead.leadId': 1 },
        { name: 'qualification_inbox_campaign_received_at' },
      ),
      this.decisions.createIndex(
        { campaignId: 1, profileVersion: 1, 'lead.leadId': 1 },
        { name: 'qualification_decision_campaign_profile_lead' },
      ),
      this.enrichments.createIndex(
        { campaignId: 1, profileVersion: 1, leadId: 1 },
        { name: 'qualification_enrichment_campaign_profile_lead' },
      ),
    ]);
  }

  public async findExecution(executionId: string): Promise<IQualificationExecutionView | undefined> {
    const execution = await this.executions.findOne({ executionId });

    return execution === null ? undefined : execution;
  }

  public async findLead(campaignId: string, leadId: string, profileVersion: number): Promise<IQualificationLeadView | undefined> {
    const decision = await this.decisions.findOne({ campaignId, 'lead.leadId': leadId, profileVersion });

    return decision === null ? undefined : this.createLeadView(decision);
  }

  public async getStatusCounts(campaignId: string, profileVersion: number): Promise<IQualificationStatusCounts> {
    const [leadIds, completed, processing, qualified, rejected, decisions] = await Promise.all([
      this.inbox.distinct('lead.leadId', { campaignId }),
      this.executions.countDocuments({ campaignId, profileVersion, status: 'completed' }),
      this.executions.countDocuments({ campaignId, profileVersion, status: 'processing' }),
      this.decisions.countDocuments({ campaignId, profileVersion, 'decision.decision': QUALIFICATION_DECISION.QUALIFIED }),
      this.decisions.countDocuments({ campaignId, profileVersion, 'decision.decision': QUALIFICATION_DECISION.REJECTED }),
      this.decisions.distinct('lead.leadId', { campaignId, profileVersion }),
    ]);
    const completedLeadIds = new Set(decisions);

    return {
      completed,
      processing,
      qualified,
      received: leadIds.length,
      rejected,
      remaining: leadIds.filter((leadId) => !completedLeadIds.has(leadId)).length,
    };
  }

  public async listLeads(input: IQualificationLeadListInput): Promise<IQualificationLeadListPage> {
    const [inboxRecords, decisions, enrichments, executions] = await Promise.all([
      this.inbox.find({ campaignId: input.campaignId }).toArray(),
      this.decisions.find({
        campaignId: input.campaignId,
        profileVersion: input.profileVersion,
      }).toArray(),
      this.enrichments.find({
        campaignId: input.campaignId,
        profileVersion: input.profileVersion,
      }).toArray(),
      this.executions.find({
        campaignId: input.campaignId,
        profileVersion: input.profileVersion,
      }).toArray(),
    ]);
    const decisionByLeadId = new Map(
      decisions.map((decision) => [decision.lead.leadId, decision]),
    );
    const enrichmentByLeadId = new Map(
      enrichments.map((enrichment) => [enrichment.leadId, enrichment]),
    );
    const processingLeadIds = new Set(
      executions
        .filter((execution) => execution.status === 'processing')
        .map((execution) => execution.leadId),
    );
    const items = inboxRecords
      .map((record) => createLeadListItem(
        record,
        decisionByLeadId.get(record.lead.leadId),
        enrichmentByLeadId.get(record.lead.leadId),
        processingLeadIds.has(record.lead.leadId),
      ))
      .sort((left, right) => compareLeadListItems(left, right, input));

    return {
      items: items.slice(input.offset, input.offset + input.limit),
      total: items.length,
    };
  }

  public async listExecutions(campaignId: string, offset: number, limit: number): Promise<{ readonly items: readonly IQualificationExecutionView[]; readonly total: number }> {
    const [items, total] = await Promise.all([
      this.executions.find({ campaignId }).sort({ completedAt: -1, leadId: 1 }).skip(offset).limit(limit).toArray(),
      this.executions.countDocuments({ campaignId }),
    ]);

    return { items, total };
  }

  public async listQualifiedLeads(campaignId: string, profileVersion: number, offset: number, limit: number): Promise<IQualificationLeadPage> {
    const filter = { campaignId, profileVersion, 'decision.decision': QUALIFICATION_DECISION.QUALIFIED };
    const [decisions, total] = await Promise.all([
      this.decisions.find(filter).sort({ recordedAt: -1, 'lead.leadId': 1 }).skip(offset).limit(limit).toArray(),
      this.decisions.countDocuments(filter),
    ]);

    return { items: await Promise.all(decisions.map((decision) => this.createLeadView(decision))), total };
  }

  private async createLeadView(decision: IQualificationDecisionRecord): Promise<IQualificationLeadView> {
    const enrichment = await this.enrichments.findOne({
      campaignId: decision.campaignId,
      leadId: decision.lead.leadId,
      profileVersion: decision.profileVersion,
    });

    return {
      decision,
      enrichment,
      enrichmentState: enrichment === null ? ENRICHMENT_STATE.PENDING : ENRICHMENT_STATE.AVAILABLE,
    };
  }
}

function createLeadListItem(
  record: IQualificationInboxRecord,
  decision: IQualificationDecisionRecord | undefined,
  enrichment: IQualificationEnrichmentSnapshot | undefined,
  processing: boolean,
): IQualificationLeadListItem {
  return {
    createdAt: record.receivedAt,
    ...(decision === undefined ? {} : { decision }),
    enrichment: enrichment ?? null,
    enrichmentState: enrichment === undefined
      ? ENRICHMENT_STATE.PENDING
      : ENRICHMENT_STATE.AVAILABLE,
    lead: record.lead,
    processing,
  };
}

function compareLeadListItems(
  left: IQualificationLeadListItem,
  right: IQualificationLeadListItem,
  input: IQualificationLeadListInput,
): number {
  const direction = input.sortDirection === QUALIFICATION_LEAD_SORT_DIRECTION.ASC
    ? 1
    : -1;

  if (
    input.sortBy !== QUALIFICATION_LEAD_SORT_BY.CREATED_AT
    && input.sortBy !== QUALIFICATION_LEAD_SORT_BY.NAME
  ) {
    const leftValue = getMetricSortValue(left.enrichment, input.sortBy);
    const rightValue = getMetricSortValue(right.enrichment, input.sortBy);

    if (leftValue === undefined && rightValue !== undefined) {
      return 1;
    }
    if (leftValue !== undefined && rightValue === undefined) {
      return -1;
    }
    if (leftValue === undefined || rightValue === undefined) {
      return left.lead.leadId.localeCompare(right.lead.leadId, 'en');
    }

    const comparison = compareNumbers(leftValue, rightValue);

    return comparison === 0
      ? left.lead.leadId.localeCompare(right.lead.leadId, 'en')
      : comparison * direction;
  }

  const comparison = input.sortBy === QUALIFICATION_LEAD_SORT_BY.CREATED_AT
    ? compareNumbers(left.createdAt.getTime(), right.createdAt.getTime())
    : input.sortBy === QUALIFICATION_LEAD_SORT_BY.NAME
      ? compareLeadNames(left, right)
      : 0;

  return comparison === 0
    ? left.lead.leadId.localeCompare(right.lead.leadId, 'en')
    : comparison * direction;
}

function compareLeadNames(
  left: IQualificationLeadListItem,
  right: IQualificationLeadListItem,
): number {
  return (left.lead.name ?? '').localeCompare(right.lead.name ?? '', 'en');
}

function getMetricSortValue(
  enrichment: IQualificationEnrichmentSnapshot | null,
  sortBy: QUALIFICATION_LEAD_SORT_BY,
): number | undefined {
  if (enrichment === null) {
    return undefined;
  }

  const metricKind = getMetricKind(sortBy);
  const metric = enrichment.metrics.find((item) => item.kind === metricKind);

  if (
    metric === undefined
    || metric.availability !== ENRICHMENT_METRIC_AVAILABILITY.AVAILABLE
    || metric.value === undefined
  ) {
    return undefined;
  }
  if (metricKind === ENRICHMENT_METRIC_KIND.FULL_SERVICE_HOTEL_SIGNAL) {
    return getFullServiceSignalValue(metric.value);
  }

  const parsed = Number(metric.value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function getMetricKind(
  sortBy: QUALIFICATION_LEAD_SORT_BY,
): ENRICHMENT_METRIC_KIND {
  switch (sortBy) {
    case QUALIFICATION_LEAD_SORT_BY.FULL_SERVICE_HOTEL_SIGNAL:
      return ENRICHMENT_METRIC_KIND.FULL_SERVICE_HOTEL_SIGNAL;
    case QUALIFICATION_LEAD_SORT_BY.MARKET_PRICE_POSITION:
      return ENRICHMENT_METRIC_KIND.MARKET_PRICE_POSITION;
    case QUALIFICATION_LEAD_SORT_BY.MARKET_VALUE_PROXY:
      return ENRICHMENT_METRIC_KIND.MARKET_VALUE_PROXY;
    case QUALIFICATION_LEAD_SORT_BY.MONETISABLE_ASSET_COUNT:
      return ENRICHMENT_METRIC_KIND.MONETISABLE_ASSET_COUNT;
    case QUALIFICATION_LEAD_SORT_BY.PUBLIC_ADR:
      return ENRICHMENT_METRIC_KIND.PUBLIC_ADR;
    case QUALIFICATION_LEAD_SORT_BY.REVIEW_VOLUME:
      return ENRICHMENT_METRIC_KIND.REVIEW_VOLUME;
    default:
      throw new Error('unsupported Qualification metric sort field');
  }
}

function getFullServiceSignalValue(value: string): number | undefined {
  if (value === FULL_SERVICE_HOTEL_SIGNAL.FULL_SERVICE) {
    return 3;
  }
  if (value === FULL_SERVICE_HOTEL_SIGNAL.LIMITED_SERVICE) {
    return 2;
  }
  if (value === FULL_SERVICE_HOTEL_SIGNAL.NO_SIGNAL) {
    return 1;
  }

  return undefined;
}

function compareNumbers(left: number, right: number): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
