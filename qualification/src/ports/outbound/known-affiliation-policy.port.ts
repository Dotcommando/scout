import {
  IKnownAffiliationMatch,
} from '../../domain/qualification/known-affiliation-policy.js';
import {
  ILeadSnapshot,
  KNOWN_AFFILIATION_SCOPE,
} from '../../domain/qualification/qualification-model.js';

export interface IKnownAffiliationPolicyPort {
  findMatch(
    lead: ILeadSnapshot,
    enabledScopes: readonly KNOWN_AFFILIATION_SCOPE[] | undefined,
  ): IKnownAffiliationMatch | null;
}
