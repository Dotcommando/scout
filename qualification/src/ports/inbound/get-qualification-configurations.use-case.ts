import { IStoredQualificationConfiguration } from '../../app/qualification/qualification-configuration.js';

export const GET_QUALIFICATION_CONFIGURATIONS_USE_CASE = Symbol('GET_QUALIFICATION_CONFIGURATIONS_USE_CASE');

export interface IQualificationConfigurationPage {
  readonly items: readonly IStoredQualificationConfiguration[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface IGetQualificationConfigurationsUseCase {
  getConfigurations(offset: number, limit: number): Promise<IQualificationConfigurationPage>;
}
