import {
  IKnownAffiliationCatalogEntry,
  KnownAffiliationPolicy,
  normalizeKnownAffiliationValue,
} from './known-affiliation-policy.js';
import {
  KNOWN_AFFILIATION_EVIDENCE,
  KNOWN_AFFILIATION_MATCH_STRATEGY,
  KNOWN_AFFILIATION_SCOPE,
} from './qualification-model.js';

describe('KnownAffiliationPolicy', () => {
  it('normalizes Unicode compatibility characters and punctuation deterministically', () => {
    expect(normalizeKnownAffiliationValue('  Ｈilton—Garden  ')).toBe(
      'hilton garden',
    );
  });

  it('matches only an exact normalized full name when configured', () => {
    const policy = new KnownAffiliationPolicy('revision-1', [
      createEntry({
        aliases: [createAlias(
          'Hilton Garden',
          KNOWN_AFFILIATION_MATCH_STRATEGY.EXACT_NORMALIZED_FULL_NAME,
        )],
      }),
    ]);

    expect(policy.findMatch(createLead('  Ｈilton—Garden '), allScopes())).toMatchObject({
      catalogEntryId: 'entry-1',
      evidence: KNOWN_AFFILIATION_EVIDENCE.CONFIRMED,
    });
    expect(policy.findMatch(createLead('Hilton Garden London'), allScopes())).toBeNull();
  });

  it('matches a configured token sequence only at token boundaries', () => {
    const policy = new KnownAffiliationPolicy('revision-1', [
      createEntry({
        aliases: [createAlias(
          'Hilton Garden',
          KNOWN_AFFILIATION_MATCH_STRATEGY.EXACT_TOKEN_SEQUENCE_NAME,
        )],
      }),
    ]);

    expect(policy.findMatch(createLead('Hilton Garden Central'), allScopes())).not.toBeNull();
    expect(policy.findMatch(createLead('HiltonGardener Central'), allScopes())).toBeNull();
  });

  it('matches an official host and its subdomains', () => {
    const policy = new KnownAffiliationPolicy('revision-1', [
      createEntry({ websiteHosts: ['example-affiliation.test'] }),
    ]);

    expect(policy.findMatch(
      createLead('Unaffiliated', 'https://booking.example-affiliation.test/path'),
      allScopes(),
    )).toMatchObject({
      matchStrategy: KNOWN_AFFILIATION_MATCH_STRATEGY.WEBSITE_HOST_OR_SUBDOMAIN,
    });
  });

  it('respects a profile choice to exclude collection and soft-brand scopes', () => {
    const policy = new KnownAffiliationPolicy('revision-1', [
      createEntry({ scopes: [KNOWN_AFFILIATION_SCOPE.COLLECTION] }),
    ]);

    expect(policy.findMatch(createLead('Hilton Garden'), [
      KNOWN_AFFILIATION_SCOPE.FRANCHISE,
    ])).toBeNull();
    expect(policy.findMatch(createLead('Hilton Garden'), [
      KNOWN_AFFILIATION_SCOPE.COLLECTION,
    ])).not.toBeNull();
  });

  it('returns configured ambiguous evidence without claiming independence on no match', () => {
    const policy = new KnownAffiliationPolicy('revision-1', [
      createEntry({
        aliases: [
          {
            evidence: KNOWN_AFFILIATION_EVIDENCE.AMBIGUOUS,
            strategy: KNOWN_AFFILIATION_MATCH_STRATEGY.EXACT_TOKEN_SEQUENCE_NAME,
            value: 'W',
          },
        ],
      }),
    ]);

    expect(policy.findMatch(createLead('W Central'), allScopes())?.evidence).toBe(
      KNOWN_AFFILIATION_EVIDENCE.AMBIGUOUS,
    );
    expect(policy.findMatch(createLead('Independent Place'), allScopes())).toBeNull();
  });

  it('does not use a disabled catalog entry', () => {
    const policy = new KnownAffiliationPolicy('revision-1', [
      createEntry({
        enabled: false,
        websiteHosts: ['example-affiliation.test'],
      }),
    ]);

    expect(policy.findMatch(
      createLead('Hilton Garden', 'https://example-affiliation.test'),
      allScopes(),
    )).toBeNull();
  });
});

function allScopes(): readonly KNOWN_AFFILIATION_SCOPE[] {
  return [
    KNOWN_AFFILIATION_SCOPE.COLLECTION,
    KNOWN_AFFILIATION_SCOPE.FRANCHISE,
    KNOWN_AFFILIATION_SCOPE.MANAGEMENT,
    KNOWN_AFFILIATION_SCOPE.SOFT_BRAND,
  ];
}

function createAlias(
  value: string,
  strategy: KNOWN_AFFILIATION_MATCH_STRATEGY,
) {
  return {
    evidence: KNOWN_AFFILIATION_EVIDENCE.CONFIRMED,
    strategy,
    value,
  };
}

function createEntry(
  overrides: Partial<IKnownAffiliationCatalogEntry> = {},
): IKnownAffiliationCatalogEntry {
  return {
    aliases: [createAlias(
      'Hilton Garden',
      KNOWN_AFFILIATION_MATCH_STRATEGY.EXACT_TOKEN_SEQUENCE_NAME,
    )],
    effectiveRevision: 'revision-1',
    enabled: true,
    entryId: 'entry-1',
    ownerLabel: 'Example owner',
    scopes: [KNOWN_AFFILIATION_SCOPE.FRANCHISE],
    sourceUrl: 'https://example-affiliation.test/portfolio',
    websiteHosts: [],
    ...overrides,
  };
}

function createLead(name: string, websiteUrl?: string) {
  return {
    externalId: 'external-1',
    leadId: 'lead-1',
    name,
    sourceKind: 'directory',
    ...(websiteUrl === undefined ? {} : { websiteUrl }),
  };
}
