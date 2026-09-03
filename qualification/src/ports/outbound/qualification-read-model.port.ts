import { ENRICHMENT_STATE, IQualificationEnrichmentSnapshot } from '../../domain/enrichment/enrichment-model.js';
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
  listExecutions(campaignId: string, offset: number, limit: number): Promise<{ readonly items: readonly IQualificationExecutionView[]; readonly total: number }>;
  listQualifiedLeads(campaignId: string, profileVersion: number, offset: number, limit: number): Promise<IQualificationLeadPage>;
}
