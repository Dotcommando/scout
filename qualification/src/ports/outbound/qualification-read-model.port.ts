import { ENRICHMENT_STATE, IQualificationEnrichmentSnapshot } from '../../domain/enrichment/enrichment-model.js';
import { ILeadSnapshot } from '../../domain/qualification/qualification-model.js';
import { IQualificationDecisionRecord } from './qualification-decision-repository.port.js';

export const QUALIFICATION_READ_MODEL = Symbol('QUALIFICATION_READ_MODEL');

export interface IQualificationExecutionView {
  readonly campaignId: string;
  readonly claimedAt?: Date;
  readonly completedAt?: Date;
  readonly executionId: string;
  readonly leadId: string;
  readonly profileVersion: number;
  readonly status: string;
}

export interface IQualificationLeadView {
  readonly decision: IQualificationDecisionRecord;
  readonly enrichment: IQualificationEnrichmentSnapshot | null;
  readonly enrichmentState: ENRICHMENT_STATE;
}

export interface IQualificationLeadPage {
  readonly items: readonly IQualificationLeadView[];
  readonly total: number;
}

export enum QUALIFICATION_LEAD_SORT_BY {
  CREATED_AT = 'createdAt',
  FULL_SERVICE_HOTEL_SIGNAL = 'fullServiceHotelSignal',
  MARKET_PRICE_POSITION = 'marketPricePosition',
  MARKET_VALUE_PROXY = 'marketValueProxy',
  MONETISABLE_ASSET_COUNT = 'monetisableAssetCount',
  NAME = 'name',
  PUBLIC_ADR = 'publicAdr',
  REVIEW_VOLUME = 'reviewVolume',
}

export const QUALIFICATION_LEAD_SORT_BY_ARRAY = Object.values(
  QUALIFICATION_LEAD_SORT_BY,
);

export enum QUALIFICATION_LEAD_SORT_DIRECTION {
  ASC = 'asc',
  DESC = 'desc',
}

export const QUALIFICATION_LEAD_SORT_DIRECTION_ARRAY = Object.values(
  QUALIFICATION_LEAD_SORT_DIRECTION,
);

export interface IQualificationLeadListInput {
  readonly campaignId: string;
  readonly limit: number;
  readonly offset: number;
  readonly profileVersion: number;
  readonly sortBy: QUALIFICATION_LEAD_SORT_BY;
  readonly sortDirection: QUALIFICATION_LEAD_SORT_DIRECTION;
}

export interface IQualificationLeadListItem {
  readonly createdAt: Date;
  readonly decision?: IQualificationDecisionRecord;
  readonly enrichment: IQualificationEnrichmentSnapshot | null;
  readonly enrichmentState: ENRICHMENT_STATE;
  readonly lead: ILeadSnapshot;
  readonly processing: boolean;
}

export interface IQualificationLeadListPage {
  readonly items: readonly IQualificationLeadListItem[];
  readonly total: number;
}

export interface IQualificationStatusCounts {
  readonly completed: number;
  readonly processing: number;
  readonly qualified: number;
  readonly rejected: number;
  readonly received: number;
  readonly remaining: number;
}

export interface IQualificationReadModelPort {
  findExecution(executionId: string): Promise<IQualificationExecutionView | undefined>;
  findLead(campaignId: string, leadId: string, profileVersion: number): Promise<IQualificationLeadView | undefined>;
  getStatusCounts(campaignId: string, profileVersion: number): Promise<IQualificationStatusCounts>;
  listLeads(input: IQualificationLeadListInput): Promise<IQualificationLeadListPage>;
  listExecutions(campaignId: string, offset: number, limit: number): Promise<{ readonly items: readonly IQualificationExecutionView[]; readonly total: number }>;
  listQualifiedLeads(campaignId: string, profileVersion: number, offset: number, limit: number): Promise<IQualificationLeadPage>;
}
