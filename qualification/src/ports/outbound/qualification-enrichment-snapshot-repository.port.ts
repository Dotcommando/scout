import { IQualificationEnrichmentSnapshot } from '../../domain/enrichment/enrichment-model.js';

export interface IQualificationEnrichmentSnapshotRepositoryPort {
  findSnapshot(
    campaignId: string,
    leadId: string,
    profileVersion: number,
  ): Promise<IQualificationEnrichmentSnapshot | null>;
  saveSnapshot(snapshot: IQualificationEnrichmentSnapshot): Promise<void>;
}
