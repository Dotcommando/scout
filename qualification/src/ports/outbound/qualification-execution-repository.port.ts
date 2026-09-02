import { QUALIFICATION_EXECUTION_STATUS } from '../../domain/qualification/qualification-model.js';

export enum QUALIFICATION_EXECUTION_CLAIM_OUTCOME {
  ALREADY_COMPLETED = 'already-completed',
  CLAIMED = 'claimed',
  IN_PROGRESS = 'in-progress',
}

export interface IClaimQualificationExecutionInput {
  readonly campaignId: string;
  readonly claimedAt: Date;
  readonly leadId: string;
  readonly profileVersion: number;
  readonly staleClaimBefore: Date;
  readonly workerId: string;
}

export interface ICompleteQualificationExecutionInput {
  readonly campaignId: string;
  readonly completedAt: Date;
  readonly leadId: string;
  readonly profileVersion: number;
  readonly workerId: string;
}

export interface IQualificationExecutionRecord {
  readonly campaignId: string;
  readonly leadId: string;
  readonly profileVersion: number;
  readonly status: QUALIFICATION_EXECUTION_STATUS;
}

export interface IQualificationExecutionRepositoryPort {
  claimExecution(
    input: IClaimQualificationExecutionInput,
  ): Promise<QUALIFICATION_EXECUTION_CLAIM_OUTCOME>;
  completeExecution(input: ICompleteQualificationExecutionInput): Promise<boolean>;
}
