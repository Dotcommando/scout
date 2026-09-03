import {
  ILeadSnapshot,
  QUALIFICATION_INPUT_STATUS,
} from '../../domain/qualification/qualification-model.js';

export interface IQualificationInboxRecord {
  readonly campaignId: string;
  readonly correlationId: string;
  readonly eventId: string;
  readonly lead: ILeadSnapshot;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
  readonly status: QUALIFICATION_INPUT_STATUS;
}

export interface IQualificationInboxRepositoryPort {
  findInput(campaignId: string, leadId: string): Promise<IQualificationInboxRecord | undefined>;
  recordInput(input: IQualificationInboxRecord): Promise<void>;
}
