import { KnownAffiliationPolicy } from './known-affiliation-policy.js';
import {
  ILeadSnapshot,
  IQualificationProfile,
  KNOWN_AFFILIATION_MATCH_STRATEGY,
  KNOWN_AFFILIATION_SCOPE,
  QUALIFICATION_DECISION,
  QUALIFICATION_REASON_CODE,
} from './qualification-model.js';
import { evaluateQualificationProfile } from './qualification-rule-evaluator.js';

const profile: IQualificationProfile = {
  campaignId: 'campaign-1',
  contentHash: 'profile-hash',
  excludedSourceIdentities: [
    { externalId: 'excluded-1', sourceKind: 'directory' },
  ],
  excludedWebsiteHosts: ['excluded.example'],
  profileId: 'baseline',
  requirements: {
    address: false,
    name: true,
    phoneNumber: true,
    websiteUrl: false,
  },
  version: 1,
};

describe('evaluateQualificationProfile', () => {
  it('rejects an exact excluded source identity before evaluating optional signals', () => {
    const decision = evaluateQualificationProfile(profile, {
      externalId: 'excluded-1',
      leadId: 'lead-1',
      sourceKind: 'directory',
    });

    expect(decision.decision).toBe(QUALIFICATION_DECISION.REJECTED);
    expect(decision.reasons[0]?.code).toBe(
      QUALIFICATION_REASON_CODE.EXCLUDED_SOURCE_IDENTITY,
    );
  });

  it('returns an auditable indeterminate decision when a required signal is absent', () => {
    const decision = evaluateQualificationProfile(profile, createLead({
      phoneNumber: undefined,
    }));

    expect(decision.decision).toBe(QUALIFICATION_DECISION.INDETERMINATE);
    expect(decision.reasons.map((reason) => reason.code)).toEqual([
      QUALIFICATION_REASON_CODE.MISSING_REQUIRED_PHONE_NUMBER,
    ]);
  });

  it('rejects an exact excluded website host', () => {
    const decision = evaluateQualificationProfile(profile, createLead({
      websiteUrl: 'https://excluded.example/path',
    }));

    expect(decision.decision).toBe(QUALIFICATION_DECISION.REJECTED);
    expect(decision.reasons[0]?.code).toBe(
      QUALIFICATION_REASON_CODE.EXCLUDED_WEBSITE_HOST,
    );
  });

  it('records a configured affiliation entry and strategy in a rejected decision', () => {
    const policy = new KnownAffiliationPolicy('catalog-r1', [
      {
        aliases: [],
        effectiveRevision: 'catalog-r1',
        enabled: true,
        entryId: 'known-affiliation-1',
        ownerLabel: 'Example owner',
        scopes: [KNOWN_AFFILIATION_SCOPE.FRANCHISE],
        sourceUrl: 'https://example.test/portfolio',
        websiteHosts: ['example.test'],
      },
    ]);
    const decision = evaluateQualificationProfile(
      {
        ...profile,
        knownAffiliationScopes: [KNOWN_AFFILIATION_SCOPE.FRANCHISE],
      },
      createLead({ websiteUrl: 'https://booking.example.test' }),
      policy,
    );

    expect(decision.decision).toBe(QUALIFICATION_DECISION.REJECTED);
    expect(decision.reasons[0]).toMatchObject({
      code: QUALIFICATION_REASON_CODE.KNOWN_AFFILIATION_WEBSITE_HOST,
      context: {
        catalogEntryId: 'known-affiliation-1',
        catalogRevision: 'catalog-r1',
        matchStrategy: KNOWN_AFFILIATION_MATCH_STRATEGY.WEBSITE_HOST_OR_SUBDOMAIN,
      },
    });
  });

  it('qualifies a lead that satisfies every configured rule', () => {
    const decision = evaluateQualificationProfile(profile, createLead());

    expect(decision.decision).toBe(QUALIFICATION_DECISION.QUALIFIED);
    expect(decision.reasons[0]?.code).toBe(
      QUALIFICATION_REASON_CODE.QUALIFICATION_RULES_SATISFIED,
    );
  });
});

function createLead(overrides: Partial<ILeadSnapshot> = {}): ILeadSnapshot {
  return {
    externalId: 'external-1',
    leadId: 'lead-1',
    name: 'Example lead',
    phoneNumber: '123',
    sourceKind: 'directory',
    ...overrides,
  };
}
