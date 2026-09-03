import { createHash } from 'node:crypto';

import { IKnownAffiliationCatalog } from '../../domain/qualification/known-affiliation-catalog.js';
import {
  IQualificationProfile,
  IQualificationRequirements,
  ISourceIdentityExclusion,
  KNOWN_AFFILIATION_SCOPE,
} from '../../domain/qualification/qualification-model.js';
import { IQualificationEnrichmentConfiguration } from '../../ports/outbound/qualification-enrichment-configuration.port.js';

export enum QUALIFICATION_CONFIGURATION_LIFECYCLE {
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  DRAFT = 'draft',
}

export const QUALIFICATION_CONFIGURATION_LIFECYCLE_ARRAY = Object.values(
  QUALIFICATION_CONFIGURATION_LIFECYCLE,
);

export interface IQualificationConfigurationInput {
  readonly campaignId: string;
  readonly catalogRevision: string;
  readonly enrichment: IQualificationEnrichmentConfiguration;
  readonly excludedSourceIdentities: readonly ISourceIdentityExclusion[];
  readonly excludedWebsiteHosts: readonly string[];
  readonly knownAffiliationScopes?: readonly KNOWN_AFFILIATION_SCOPE[];
  readonly profileId: string;
  readonly requirements: IQualificationRequirements;
}

export interface IQualificationConfiguration {
  readonly catalog: IKnownAffiliationCatalog;
  readonly campaignId: string;
  readonly catalogRevision: string;
  readonly configurationHash: string;
  readonly enrichment: IQualificationEnrichmentConfiguration;
  readonly profile: IQualificationProfile;
  readonly version: number;
}

export interface IStoredQualificationConfiguration extends IQualificationConfiguration {
  readonly createdAt: Date;
  readonly lifecycle: QUALIFICATION_CONFIGURATION_LIFECYCLE;
  readonly updatedAt: Date;
}

export function createQualificationConfiguration(
  input: IQualificationConfigurationInput,
  version: number,
  catalog: IKnownAffiliationCatalog,
): IQualificationConfiguration {
  validateConfigurationInput(input, version);
  const profile = {
    campaignId: input.campaignId,
    contentHash: '',
    excludedSourceIdentities: input.excludedSourceIdentities,
    excludedWebsiteHosts: input.excludedWebsiteHosts,
    ...(input.knownAffiliationScopes === undefined
      ? {}
      : { knownAffiliationScopes: input.knownAffiliationScopes }),
    profileId: input.profileId,
    requirements: input.requirements,
    version,
  };
  const configurationHash = createHash('sha256')
    .update(JSON.stringify({ ...input, catalog, profile, version }))
    .digest('hex');

  return {
    catalog,
    campaignId: input.campaignId,
    catalogRevision: input.catalogRevision,
    configurationHash,
    enrichment: input.enrichment,
    profile: { ...profile, contentHash: configurationHash },
    version,
  };
}

function validateConfigurationInput(input: IQualificationConfigurationInput, version: number): void {
  if (input.campaignId.trim().length === 0 || input.profileId.trim().length === 0) {
    throw new Error('campaignId and profileId must be non-empty');
  }
  if (input.catalogRevision.trim().length === 0) {
    throw new Error('catalogRevision must be non-empty');
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error('version must be a positive safe integer');
  }
  if (input.enrichment.actorDefinitionId.trim().length === 0
    || input.enrichment.actorRevision.trim().length === 0
    || input.enrichment.cachePolicyRevision.trim().length === 0
    || input.enrichment.currency.trim().length === 0
    || input.enrichment.locale.trim().length === 0) {
    throw new Error('enrichment identifiers must be non-empty');
  }
  if (!Number.isSafeInteger(input.enrichment.guests) || input.enrichment.guests < 1
    || !Number.isSafeInteger(input.enrichment.nights) || input.enrichment.nights < 1) {
    throw new Error('enrichment guests and nights must be positive safe integers');
  }
  if (input.enrichment.amenityCatalogue.some((item) => item.trim().length === 0)) {
    throw new Error('enrichment amenityCatalogue must contain non-empty values');
  }
  if (new Set(input.excludedSourceIdentities.map((item) => `${item.sourceKind}\u0000${item.externalId}`)).size
    !== input.excludedSourceIdentities.length) {
    throw new Error('excludedSourceIdentities must be unique');
  }
  if (new Set(input.excludedWebsiteHosts).size !== input.excludedWebsiteHosts.length) {
    throw new Error('excludedWebsiteHosts must be unique');
  }
}
