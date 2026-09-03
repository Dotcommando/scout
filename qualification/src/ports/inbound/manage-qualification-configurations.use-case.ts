import {
  IQualificationConfigurationInput,
  IStoredQualificationConfiguration,
} from '../../app/qualification/qualification-configuration.js';
import { IQualificationConfigurationArchiveResult } from '../outbound/qualification-configuration-repository.port.js';

export const MANAGE_QUALIFICATION_CONFIGURATIONS_USE_CASE = Symbol('MANAGE_QUALIFICATION_CONFIGURATIONS_USE_CASE');

export interface IManageQualificationConfigurationsUseCase {
  activateConfiguration(campaignId: string, expectedVersion: number): Promise<IStoredQualificationConfiguration>;
  archiveConfigurations(campaignIds: readonly string[]): Promise<IQualificationConfigurationArchiveResult>;
  createConfiguration(input: IQualificationConfigurationInput): Promise<IStoredQualificationConfiguration>;
  replaceConfiguration(campaignId: string, expectedVersion: number, input: IQualificationConfigurationInput): Promise<IStoredQualificationConfiguration>;
}
