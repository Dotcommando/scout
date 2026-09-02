import {
  DISCOVERY_SOURCE_KIND,
  Lead,
} from '../../domain/discovery/discovery-model.js';

export enum LEAD_UPSERT_OUTCOME {
  EXISTING = 'existing',
  INSERTED = 'inserted',
}

export interface ILeadRepositoryPort {
  findLeadsForBackfill(
    input: IFindLeadsForBackfillInput,
  ): Promise<ILeadBackfillPage>;
  upsertLead(lead: Lead): Promise<ILeadUpsertResult>;
}

export interface IFindLeadsForBackfillInput {
  readonly afterLeadId?: string;
  readonly limit: number;
  readonly leadIdPrefix?: string;
  readonly sourceKind: DISCOVERY_SOURCE_KIND;
}

export interface ILeadBackfillPage {
  readonly leads: readonly Lead[];
}

export interface ILeadUpsertResult {
  readonly leadId: string;
  readonly outcome: LEAD_UPSERT_OUTCOME;
}
