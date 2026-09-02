import {
  ILeadSnapshot,
  IQualificationProfile,
  QUALIFICATION_DECISION,
  QUALIFICATION_REASON_CODE,
  QUALIFICATION_RULE_KIND,
  QualificationDecision,
  QualificationReason,
} from './qualification-model.js';

export function evaluateQualificationProfile(
  profile: IQualificationProfile,
  lead: ILeadSnapshot,
): QualificationDecision {
  const sourceExcluded = profile.excludedSourceIdentities.some(
    (exclusion) => exclusion.sourceKind === lead.sourceKind
      && exclusion.externalId === lead.externalId,
  );

  if (sourceExcluded) {
    return rejected(
      QUALIFICATION_REASON_CODE.EXCLUDED_SOURCE_IDENTITY,
      QUALIFICATION_RULE_KIND.EXCLUDED_SOURCE_IDENTITY,
    );
  }

  const websiteHost = getWebsiteHost(lead.websiteUrl);

  if (
    websiteHost !== undefined
    && profile.excludedWebsiteHosts.includes(websiteHost)
  ) {
    return rejected(
      QUALIFICATION_REASON_CODE.EXCLUDED_WEBSITE_HOST,
      QUALIFICATION_RULE_KIND.EXCLUDED_WEBSITE_HOST,
    );
  }

  const missingReasons = [
    ...(profile.requirements.name && isMissing(lead.name)
      ? [
        new QualificationReason(
          QUALIFICATION_REASON_CODE.MISSING_REQUIRED_NAME,
          QUALIFICATION_RULE_KIND.REQUIRED_NAME,
        ),
      ]
      : []),
    ...(profile.requirements.address && isMissing(lead.address)
      ? [
        new QualificationReason(
          QUALIFICATION_REASON_CODE.MISSING_REQUIRED_ADDRESS,
          QUALIFICATION_RULE_KIND.REQUIRED_ADDRESS,
        ),
      ]
      : []),
    ...(profile.requirements.phoneNumber && isMissing(lead.phoneNumber)
      ? [
        new QualificationReason(
          QUALIFICATION_REASON_CODE.MISSING_REQUIRED_PHONE_NUMBER,
          QUALIFICATION_RULE_KIND.REQUIRED_PHONE_NUMBER,
        ),
      ]
      : []),
    ...(profile.requirements.websiteUrl && isMissing(lead.websiteUrl)
      ? [
        new QualificationReason(
          QUALIFICATION_REASON_CODE.MISSING_REQUIRED_WEBSITE_URL,
          QUALIFICATION_RULE_KIND.REQUIRED_WEBSITE_URL,
        ),
      ]
      : []),
  ];

  if (missingReasons.length > 0) {
    return new QualificationDecision(
      QUALIFICATION_DECISION.INDETERMINATE,
      missingReasons,
    );
  }

  return new QualificationDecision(QUALIFICATION_DECISION.QUALIFIED, [
    new QualificationReason(
      QUALIFICATION_REASON_CODE.QUALIFICATION_RULES_SATISFIED,
      QUALIFICATION_RULE_KIND.REQUIRED_NAME,
    ),
  ]);
}

function getWebsiteHost(websiteUrl: string | undefined): string | undefined {
  if (websiteUrl === undefined) {
    return undefined;
  }

  try {
    return new URL(websiteUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isMissing(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

function rejected(
  code: QUALIFICATION_REASON_CODE,
  ruleKind: QUALIFICATION_RULE_KIND,
): QualificationDecision {
  return new QualificationDecision(QUALIFICATION_DECISION.REJECTED, [
    new QualificationReason(code, ruleKind),
  ]);
}
