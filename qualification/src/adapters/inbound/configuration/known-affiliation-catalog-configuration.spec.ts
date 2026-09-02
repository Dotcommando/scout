import {
  KnownAffiliationCatalogValidationError,
  parseKnownAffiliationCatalog,
} from './known-affiliation-catalog-configuration.js';

const CONFIGURATION_FILE_PATH = '/configuration/known-affiliations.yaml';

describe('parseKnownAffiliationCatalog', () => {
  it('rejects normalized duplicate aliases from conflicting entries', () => {
    expect(() => parseKnownAffiliationCatalog(
      `${createCatalog()}${createEntry('entry-2', 'Example Brand')}`,
      CONFIGURATION_FILE_PATH,
    )).toThrow(KnownAffiliationCatalogValidationError);
  });

  it('rejects an invalid host, unsupported scope, and stale revision', () => {
    expect(() => parseKnownAffiliationCatalog(
      createCatalog().replace('- example.test', '- example.test/path'),
      CONFIGURATION_FILE_PATH,
    )).toThrow('websiteHosts[0]: must be a valid host name without a path');
    expect(() => parseKnownAffiliationCatalog(
      createCatalog().replace('- franchise', '- unsupported-scope'),
      CONFIGURATION_FILE_PATH,
    )).toThrow('scopes[0]: must be a supported enum value');
    expect(() => parseKnownAffiliationCatalog(
      createCatalog().replace('effectiveRevision: revision-1', 'effectiveRevision: stale'),
      CONFIGURATION_FILE_PATH,
    )).toThrow('effectiveRevision: must equal catalog revision');
  });

  it('retains disabled entries for audit but leaves their state explicit', () => {
    const catalog = parseKnownAffiliationCatalog(
      createCatalog().replace('enabled: true', 'enabled: false'),
      CONFIGURATION_FILE_PATH,
    );

    expect(catalog.entries[0]?.enabled).toBe(false);
  });
});

function createCatalog(): string {
  return `revision: revision-1
entries:
${createEntry('entry-1', 'Example Brand')}`;
}

function createEntry(entryId: string, alias: string): string {
  return `  - entryId: ${entryId}
    ownerLabel: Example owner
    enabled: true
    effectiveRevision: revision-1
    scopes:
      - franchise
    sourceUrl: https://example.test/portfolio
    aliases:
      - value: ${alias}
        strategy: exact-token-sequence-name
        evidence: confirmed
    websiteHosts:
      - example.test
`;
}
