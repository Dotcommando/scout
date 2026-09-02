import { IQualificationProfile } from '../../domain/qualification/qualification-model.js';

export interface IQualificationProfileConfigurationPort {
  getProfile(campaignId: string): IQualificationProfile;
}
