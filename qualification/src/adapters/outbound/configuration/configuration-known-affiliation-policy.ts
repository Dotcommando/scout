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
  private policy: KnownAffiliationPolicy | undefined;

  public constructor(
    private readonly catalogConfiguration: KnownAffiliationCatalogConfiguration,
  ) {}

  public findMatch(
    lead: ILeadSnapshot,
    enabledScopes: readonly KNOWN_AFFILIATION_SCOPE[] | undefined,
  ): IKnownAffiliationMatch | null {
    return this.getPolicy().findMatch(lead, enabledScopes);
  }

  private getPolicy(): KnownAffiliationPolicy {
    if (this.policy === undefined) {
      const catalog = this.catalogConfiguration.getCatalog();

      this.policy = new KnownAffiliationPolicy(catalog.revision, catalog.entries);
    }

    return this.policy;
  }
}
