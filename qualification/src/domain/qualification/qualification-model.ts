export enum QUALIFICATION_DECISION {
  INDETERMINATE = 'indeterminate',
  QUALIFIED = 'qualified',
  REJECTED = 'rejected',
}

export const QUALIFICATION_DECISION_ARRAY = Object.values(QUALIFICATION_DECISION);

export enum QUALIFICATION_REASON_CODE {
  EXCLUDED_SOURCE_IDENTITY = 'excluded-source-identity',
  EXCLUDED_WEBSITE_HOST = 'excluded-website-host',
  KNOWN_AFFILIATION_NAME = 'known-affiliation-name',
  KNOWN_AFFILIATION_WEBSITE_HOST = 'known-affiliation-website-host',
  MISSING_REQUIRED_ADDRESS = 'missing-required-address',
  MISSING_REQUIRED_NAME = 'missing-required-name',
  MISSING_REQUIRED_PHONE_NUMBER = 'missing-required-phone-number',
  MISSING_REQUIRED_WEBSITE_URL = 'missing-required-website-url',
  POSSIBLE_AFFILIATION = 'possible-affiliation',
  QUALIFICATION_RULES_SATISFIED = 'qualification-rules-satisfied',
}

export const QUALIFICATION_REASON_CODE_ARRAY = Object.values(
  QUALIFICATION_REASON_CODE,
);

export enum QUALIFICATION_RULE_KIND {
  EXCLUDED_SOURCE_IDENTITY = 'excluded-source-identity',
  EXCLUDED_WEBSITE_HOST = 'excluded-website-host',
  KNOWN_AFFILIATION = 'known-affiliation',
  REQUIRED_ADDRESS = 'required-address',
  REQUIRED_NAME = 'required-name',
  REQUIRED_PHONE_NUMBER = 'required-phone-number',
  REQUIRED_WEBSITE_URL = 'required-website-url',
}

export const QUALIFICATION_RULE_KIND_ARRAY = Object.values(
  QUALIFICATION_RULE_KIND,
);

export enum QUALIFICATION_INPUT_STATUS {
  RECEIVED = 'received',
}

export const QUALIFICATION_INPUT_STATUS_ARRAY = Object.values(
  QUALIFICATION_INPUT_STATUS,
);

export enum QUALIFICATION_EXECUTION_STATUS {
  COMPLETED = 'completed',
  PROCESSING = 'processing',
}

export const QUALIFICATION_EXECUTION_STATUS_ARRAY = Object.values(
  QUALIFICATION_EXECUTION_STATUS,
);

export enum QUALIFIED_OUTPUT_STATUS {
  READY = 'ready',
}

export const QUALIFIED_OUTPUT_STATUS_ARRAY = Object.values(
  QUALIFIED_OUTPUT_STATUS,
);

export enum KNOWN_AFFILIATION_EVIDENCE {
  AMBIGUOUS = 'ambiguous',
  CONFIRMED = 'confirmed',
}

export const KNOWN_AFFILIATION_EVIDENCE_ARRAY = Object.values(
  KNOWN_AFFILIATION_EVIDENCE,
);

export enum KNOWN_AFFILIATION_MATCH_STRATEGY {
  EXACT_NORMALIZED_FULL_NAME = 'exact-normalized-full-name',
  EXACT_TOKEN_SEQUENCE_NAME = 'exact-token-sequence-name',
  WEBSITE_HOST_OR_SUBDOMAIN = 'website-host-or-subdomain',
}

export const KNOWN_AFFILIATION_MATCH_STRATEGY_ARRAY = Object.values(
  KNOWN_AFFILIATION_MATCH_STRATEGY,
);

export enum KNOWN_AFFILIATION_SCOPE {
  COLLECTION = 'collection',
  FRANCHISE = 'franchise',
  MANAGEMENT = 'management',
  SOFT_BRAND = 'soft-brand',
}

export const KNOWN_AFFILIATION_SCOPE_ARRAY = Object.values(
  KNOWN_AFFILIATION_SCOPE,
);

export interface ILeadSnapshot {
  readonly address?: string;
  readonly externalId: string;
  readonly leadId: string;
  readonly name?: string;
  readonly phoneNumber?: string;
  readonly sourceKind: string;
  readonly websiteUrl?: string;
}

export class Lead {
  public constructor(
    public readonly snapshot: ILeadSnapshot,
  ) {
    requireNonEmptyValue(snapshot.externalId, 'externalId');
    requireNonEmptyValue(snapshot.leadId, 'leadId');
    requireNonEmptyValue(snapshot.sourceKind, 'sourceKind');
  }
}

export interface ISourceIdentityExclusion {
  readonly externalId: string;
  readonly sourceKind: string;
}

export interface IQualificationRequirements {
  readonly address: boolean;
  readonly name: boolean;
  readonly phoneNumber: boolean;
  readonly websiteUrl: boolean;
}

export interface IQualificationProfile {
  readonly campaignId: string;
  readonly contentHash: string;
  readonly excludedSourceIdentities: readonly ISourceIdentityExclusion[];
  readonly excludedWebsiteHosts: readonly string[];
  readonly profileId: string;
  readonly requirements: IQualificationRequirements;
  readonly knownAffiliationScopes?: readonly KNOWN_AFFILIATION_SCOPE[];
  readonly version: number;
}

export interface IQualificationReasonContext {
  readonly catalogEntryId: string;
  readonly catalogRevision: string;
  readonly matchStrategy: KNOWN_AFFILIATION_MATCH_STRATEGY;
}

export class QualificationProfile {
  public constructor(public readonly value: IQualificationProfile) {
    requireNonEmptyValue(value.campaignId, 'campaignId');
    requireNonEmptyValue(value.contentHash, 'contentHash');
    requireNonEmptyValue(value.profileId, 'profileId');

    if (!Number.isSafeInteger(value.version) || value.version < 1) {
      throw new Error('profile version must be a positive safe integer');
    }
  }
}

export class QualificationReason {
  public constructor(
    public readonly code: QUALIFICATION_REASON_CODE,
    public readonly ruleKind: QUALIFICATION_RULE_KIND,
    public readonly context?: IQualificationReasonContext,
  ) {}
}

export class QualificationDecision {
  public constructor(
    public readonly decision: QUALIFICATION_DECISION,
    public readonly reasons: readonly QualificationReason[],
  ) {
    if (reasons.length === 0) {
      throw new Error('qualification decision must include at least one reason');
    }
  }
}

export class QualificationExecution {
  public constructor(
    public readonly campaignId: string,
    public readonly leadId: string,
    public readonly profileVersion: number,
    public readonly status: QUALIFICATION_EXECUTION_STATUS,
  ) {
    requireNonEmptyValue(campaignId, 'campaignId');
    requireNonEmptyValue(leadId, 'leadId');

    if (!Number.isSafeInteger(profileVersion) || profileVersion < 1) {
      throw new Error('profileVersion must be a positive safe integer');
    }
  }
}

function requireNonEmptyValue(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }
}
