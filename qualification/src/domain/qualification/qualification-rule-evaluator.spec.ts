import {
  ILeadSnapshot,
  IQualificationProfile,
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
