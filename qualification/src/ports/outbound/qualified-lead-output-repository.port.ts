import {
  ILeadSnapshot,
  QUALIFIED_OUTPUT_STATUS,
} from '../../domain/qualification/qualification-model.js';

export interface IQualifiedLeadOutputRecord {
  readonly campaignId: string;
  readonly createdAt: Date;
  readonly decisionEventId: string;
  readonly lead: ILeadSnapshot;
  readonly outputId: string;
  readonly profileVersion: number;
  readonly status: QUALIFIED_OUTPUT_STATUS;
}

export interface IQualifiedLeadOutputRepositoryPort {
  saveQualifiedLeadOutput(input: IQualifiedLeadOutputRecord): Promise<void>;
}
