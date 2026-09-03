import {
  IQualificationConfiguration,
  IStoredQualificationConfiguration,
} from '../../app/qualification/qualification-configuration.js';

export const QUALIFICATION_CONFIGURATION_REPOSITORY = Symbol('QUALIFICATION_CONFIGURATION_REPOSITORY');

export interface IQualificationConfigurationPage {
  readonly items: readonly IStoredQualificationConfiguration[];
  readonly total: number;
}

export interface IQualificationConfigurationArchiveConflict {
  readonly campaignId: string;
  readonly reason: string;
}

export interface IQualificationConfigurationArchiveResult {
  readonly archivedCampaignIds: readonly string[];
  readonly conflicts: readonly IQualificationConfigurationArchiveConflict[];
}

export interface IQualificationConfigurationRepositoryPort {
  activateConfiguration(campaignId: string, expectedVersion: number, activatedAt: Date): Promise<IStoredQualificationConfiguration | undefined>;
  archiveConfigurations(campaignIds: readonly string[], archivedAt: Date): Promise<IQualificationConfigurationArchiveResult>;
  createDraftConfiguration(configuration: IQualificationConfiguration, createdAt: Date): Promise<IStoredQualificationConfiguration>;
  findActiveConfiguration(campaignId: string): Promise<IQualificationConfiguration | undefined>;
  findConfigurations(offset: number, limit: number): Promise<IQualificationConfigurationPage>;
  replaceDraftConfiguration(configuration: IQualificationConfiguration, expectedVersion: number, updatedAt: Date): Promise<IStoredQualificationConfiguration | undefined>;
  seedActiveConfiguration(configuration: IQualificationConfiguration, seededAt: Date): Promise<IQualificationConfiguration>;
}
