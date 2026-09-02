import { IKnownAffiliationCatalog } from '../../domain/qualification/known-affiliation-catalog.js';

export interface IKnownAffiliationCatalogConfigurationPort {
  getCatalog(): IKnownAffiliationCatalog;
}
