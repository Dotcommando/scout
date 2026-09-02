import { Injectable } from '@nestjs/common';

import {
  IKnownAffiliationMatch,
  KnownAffiliationPolicy,
} from '../../../domain/qualification/known-affiliation-policy.js';
import {
  ILeadSnapshot,
  KNOWN_AFFILIATION_SCOPE,
} from '../../../domain/qualification/qualification-model.js';
import { IKnownAffiliationPolicyPort } from '../../../ports/outbound/known-affiliation-policy.port.js';
import { KnownAffiliationCatalogConfiguration } from '../../inbound/configuration/known-affiliation-catalog-configuration.js';

@Injectable()
export class ConfigurationKnownAffiliationPolicy
  implements IKnownAffiliationPolicyPort {
  private readonly policy: KnownAffiliationPolicy;

  public constructor(
    catalogConfiguration: KnownAffiliationCatalogConfiguration,
  ) {
    const catalog = catalogConfiguration.getCatalog();

    this.policy = new KnownAffiliationPolicy(catalog.revision, catalog.entries);
  }

  public findMatch(
    lead: ILeadSnapshot,
    enabledScopes: readonly KNOWN_AFFILIATION_SCOPE[] | undefined,
  ): IKnownAffiliationMatch | null {
    return this.policy.findMatch(lead, enabledScopes);
  }
}
