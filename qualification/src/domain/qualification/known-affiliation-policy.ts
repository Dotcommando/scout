import {
  ILeadSnapshot,
  KNOWN_AFFILIATION_EVIDENCE,
  KNOWN_AFFILIATION_MATCH_STRATEGY,
  KNOWN_AFFILIATION_SCOPE,
} from './qualification-model.js';

export interface IKnownAffiliationMatch {
  readonly catalogEntryId: string;
  readonly catalogRevision: string;
  readonly evidence: KNOWN_AFFILIATION_EVIDENCE;
  readonly matchStrategy: KNOWN_AFFILIATION_MATCH_STRATEGY;
}

export interface IKnownAffiliationRule {
  findMatch(
    lead: ILeadSnapshot,
    enabledScopes: readonly KNOWN_AFFILIATION_SCOPE[] | undefined,
  ): IKnownAffiliationMatch | null;
}

export interface IKnownAffiliationAlias {
  readonly evidence: KNOWN_AFFILIATION_EVIDENCE;
  readonly strategy: KNOWN_AFFILIATION_MATCH_STRATEGY;
  readonly value: string;
}

export interface IKnownAffiliationCatalogEntry {
  readonly aliases: readonly IKnownAffiliationAlias[];
  readonly effectiveRevision: string;
  readonly enabled: boolean;
  readonly entryId: string;
  readonly ownerLabel: string;
  readonly scopes: readonly KNOWN_AFFILIATION_SCOPE[];
  readonly sourceUrl: string;
  readonly websiteHosts: readonly string[];
}

export class KnownAffiliationPolicy {
  public constructor(
    private readonly catalogRevision: string,
    private readonly entries: readonly IKnownAffiliationCatalogEntry[],
  ) {}

  public findMatch(
    lead: ILeadSnapshot,
    enabledScopes: readonly KNOWN_AFFILIATION_SCOPE[] | undefined,
  ): IKnownAffiliationMatch | null {
    if (enabledScopes === undefined || enabledScopes.length === 0) {
      return null;
    }

    const matchingEntries = this.entries.filter(
      (entry) => entry.enabled && entry.scopes.some(
        (scope) => enabledScopes.includes(scope),
      ),
    );
    const websiteMatch = this.findWebsiteMatch(matchingEntries, lead.websiteUrl);

    if (websiteMatch !== null) {
      return websiteMatch;
    }

    return this.findNameMatch(matchingEntries, lead.name);
  }

  private findNameMatch(
    entries: readonly IKnownAffiliationCatalogEntry[],
    name: string | undefined,
  ): IKnownAffiliationMatch | null {
    if (name === undefined) {
      return null;
    }

    const normalizedName = normalizeKnownAffiliationValue(name);
    const nameTokens = getNormalizedTokens(normalizedName);

    for (const entry of entries) {
      for (const alias of entry.aliases) {
        if (alias.strategy === KNOWN_AFFILIATION_MATCH_STRATEGY.WEBSITE_HOST_OR_SUBDOMAIN) {
          continue;
        }

        const normalizedAlias = normalizeKnownAffiliationValue(alias.value);
        const matches = alias.strategy
          === KNOWN_AFFILIATION_MATCH_STRATEGY.EXACT_NORMALIZED_FULL_NAME
          ? normalizedName === normalizedAlias
          : hasExactTokenSequence(nameTokens, getNormalizedTokens(normalizedAlias));

        if (matches) {
          return this.createMatch(entry, alias.evidence, alias.strategy);
        }
      }
    }

    return null;
  }

  private findWebsiteMatch(
    entries: readonly IKnownAffiliationCatalogEntry[],
    websiteUrl: string | undefined,
  ): IKnownAffiliationMatch | null {
    const host = getWebsiteHost(websiteUrl);

    if (host === undefined) {
      return null;
    }

    for (const entry of entries) {
      const matchingHost = entry.websiteHosts.find(
        (websiteHost) => host === websiteHost || host.endsWith(`.${websiteHost}`),
      );

      if (matchingHost !== undefined) {
        return this.createMatch(
          entry,
          KNOWN_AFFILIATION_EVIDENCE.CONFIRMED,
          KNOWN_AFFILIATION_MATCH_STRATEGY.WEBSITE_HOST_OR_SUBDOMAIN,
        );
      }
    }

    return null;
  }

  private createMatch(
    entry: IKnownAffiliationCatalogEntry,
    evidence: KNOWN_AFFILIATION_EVIDENCE,
    matchStrategy: KNOWN_AFFILIATION_MATCH_STRATEGY,
  ): IKnownAffiliationMatch {
    return {
      catalogEntryId: entry.entryId,
      catalogRevision: this.catalogRevision,
      evidence,
      matchStrategy,
    };
  }
}

export function normalizeKnownAffiliationValue(value: string): string {
  const normalizedCharacters: string[] = [];
  let previousWasSeparator = true;

  for (const character of value.normalize('NFKC').toLocaleLowerCase('en-US')) {
    if (isLetterOrNumber(character)) {
      normalizedCharacters.push(character);
      previousWasSeparator = false;
    } else if (!previousWasSeparator) {
      normalizedCharacters.push(' ');
      previousWasSeparator = true;
    }
  }

  if (normalizedCharacters.at(-1) === ' ') {
    normalizedCharacters.pop();
  }

  return normalizedCharacters.join('');
}

function getNormalizedTokens(normalizedValue: string): readonly string[] {
  return normalizedValue.length === 0 ? [] : normalizedValue.split(' ');
}

function getWebsiteHost(websiteUrl: string | undefined): string | undefined {
  if (websiteUrl === undefined) {
    return undefined;
  }

  try {
    return new URL(websiteUrl).hostname.toLocaleLowerCase('en-US');
  } catch {
    return undefined;
  }
}

function hasExactTokenSequence(
  nameTokens: readonly string[],
  aliasTokens: readonly string[],
): boolean {
  if (aliasTokens.length === 0 || aliasTokens.length > nameTokens.length) {
    return false;
  }

  for (let index = 0; index <= nameTokens.length - aliasTokens.length; index += 1) {
    if (aliasTokens.every((token, tokenIndex) => token === nameTokens[index + tokenIndex])) {
      return true;
    }
  }

  return false;
}

function isLetterOrNumber(character: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(character);
}
