import { IQualificationExecutionView, IQualificationLeadPage, IQualificationLeadView, IQualificationStatusCounts } from '../outbound/qualification-read-model.port.js';

export const GET_QUALIFICATION_OPERATIONS_USE_CASE = Symbol('GET_QUALIFICATION_OPERATIONS_USE_CASE');

export interface IQualificationStatusView extends IQualificationStatusCounts {
  readonly asOf: Date;
  readonly campaignId: string;
  readonly profileVersion: number;
}

export interface IQualificationExecutionPage {
  readonly items: readonly IQualificationExecutionView[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface IQualifiedLeadPage extends IQualificationLeadPage {
  readonly asOf: Date;
  readonly limit: number;
  readonly offset: number;
}

export interface IGetQualificationOperationsUseCase {
  getExecution(executionId: string): Promise<IQualificationExecutionView | undefined>;
  getLead(campaignId: string, leadId: string, profileVersion: number): Promise<IQualificationLeadView | undefined>;
  getQualifiedLeads(campaignId: string, profileVersion: number, offset: number, limit: number): Promise<IQualifiedLeadPage>;
  getStatus(campaignId: string, profileVersion: number): Promise<IQualificationStatusView>;
  listExecutions(campaignId: string, offset: number, limit: number): Promise<IQualificationExecutionPage>;
}
