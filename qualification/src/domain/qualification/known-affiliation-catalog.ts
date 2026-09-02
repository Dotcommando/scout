import { IKnownAffiliationCatalogEntry } from './known-affiliation-policy.js';

export interface IKnownAffiliationCatalog {
  readonly entries: readonly IKnownAffiliationCatalogEntry[];
  readonly revision: string;
}
