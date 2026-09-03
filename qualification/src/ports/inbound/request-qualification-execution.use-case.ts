import { IQualifyLeadResult } from './qualify-lead.use-case.js';

export const REQUEST_QUALIFICATION_EXECUTION_USE_CASE = Symbol('REQUEST_QUALIFICATION_EXECUTION_USE_CASE');

export interface IRequestQualificationExecutionInput {
  readonly campaignId: string;
  readonly correlationId: string;
  readonly idempotencyKey?: string;
  readonly leadId: string;
  readonly profileVersion?: number;
}

export interface IQualificationExecutionCommand {
  readonly campaignId: string;
  readonly executionId: string;
  readonly leadId: string;
  readonly qualification: IQualifyLeadResult;
}

export interface IRequestQualificationExecutionUseCase {
  requestExecution(input: IRequestQualificationExecutionInput): Promise<IQualificationExecutionCommand>;
}
