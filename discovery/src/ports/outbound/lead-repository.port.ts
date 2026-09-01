import { Lead } from '../../domain/discovery/discovery-model.js';

export enum LEAD_UPSERT_OUTCOME {
  EXISTING = 'existing',
  INSERTED = 'inserted',
}

export interface ILeadRepositoryPort {
  upsertLead(lead: Lead): Promise<ILeadUpsertResult>;
}

export interface ILeadUpsertResult {
  readonly leadId: string;
  readonly outcome: LEAD_UPSERT_OUTCOME;
}
