import { IQualificationConfiguration } from '../../app/qualification/qualification-configuration.js';

export const QUALIFICATION_CONFIGURATION_RUNTIME = Symbol('QUALIFICATION_CONFIGURATION_RUNTIME');

export interface IQualificationConfigurationRuntimePort {
  activateConfiguration(configuration: IQualificationConfiguration): void;
}
