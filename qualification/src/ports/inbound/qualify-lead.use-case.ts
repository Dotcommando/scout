import {
  ILeadSnapshot,
  QualificationDecision,
} from '../../domain/qualification/qualification-model.js';

export interface IQualifyLeadInput {
  readonly campaignId: string;
  readonly correlationId: string;
  readonly eventId: string;
  readonly lead: ILeadSnapshot;
  readonly occurredAt: Date;
  readonly workerId: string;
}

export enum QUALIFY_LEAD_OUTCOME {
  ALREADY_COMPLETED = 'already-completed',
  COMPLETED = 'completed',
  IN_PROGRESS = 'in-progress',
}

export interface IQualifyLeadResult {
  readonly decision?: QualificationDecision;
  readonly outcome: QUALIFY_LEAD_OUTCOME;
  readonly profileVersion: number;
}

export interface IQualifyLeadUseCase {
  qualifyLead(input: IQualifyLeadInput): Promise<IQualifyLeadResult>;
}
