export interface IQualificationEnrichmentConfiguration {
  readonly actorDefinitionId: string;
  readonly actorRevision: string;
  readonly amenityCatalogue: readonly string[];
  readonly cachePolicyRevision: string;
  readonly currency: string;
  readonly enabled: boolean;
  readonly guests: number;
  readonly locale: string;
  readonly nights: number;
}

export interface IQualificationEnrichmentConfigurationPort {
  getConfiguration(campaignId: string): IQualificationEnrichmentConfiguration;
}
