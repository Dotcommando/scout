import { IQualificationEnrichmentSnapshot } from '../../domain/enrichment/enrichment-model.js';

export interface IGetQualificationEnrichmentSnapshotUseCase {
  getEnrichmentSnapshot(
    campaignId: string,
    leadId: string,
    profileVersion: number,
  ): Promise<IQualificationEnrichmentSnapshot | null>;
}
