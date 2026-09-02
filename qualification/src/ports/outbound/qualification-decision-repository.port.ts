import {
  ILeadSnapshot,
  QualificationDecision,
} from '../../domain/qualification/qualification-model.js';

export interface IQualificationDecisionRecord {
  readonly campaignId: string;
  readonly decision: QualificationDecision;
  readonly eventId: string;
  readonly lead: ILeadSnapshot;
  readonly profileContentHash: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly recordedAt: Date;
}

export interface IQualificationDecisionRepositoryPort {
  findDecision(
    campaignId: string,
    leadId: string,
    profileVersion: number,
  ): Promise<IQualificationDecisionRecord | null>;
  saveDecision(input: IQualificationDecisionRecord): Promise<void>;
}
