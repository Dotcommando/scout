import { IQualificationProfile } from '../../domain/qualification/qualification-model.js';

export interface IQualificationProfileConfiguration {
  readonly configurationHash: string;
  readonly profiles: readonly IQualificationProfile[];
  readonly version: number;
}
