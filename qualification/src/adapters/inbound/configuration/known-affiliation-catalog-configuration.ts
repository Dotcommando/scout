import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { parse } from 'yaml';

import { IKnownAffiliationCatalog } from '../../../domain/qualification/known-affiliation-catalog.js';
import {
  IKnownAffiliationAlias,
  IKnownAffiliationCatalogEntry,
  normalizeKnownAffiliationValue,
} from '../../../domain/qualification/known-affiliation-policy.js';
import {
  KNOWN_AFFILIATION_EVIDENCE,
  KNOWN_AFFILIATION_MATCH_STRATEGY,
  KNOWN_AFFILIATION_SCOPE,
} from '../../../domain/qualification/qualification-model.js';
import { IKnownAffiliationCatalogConfigurationPort } from '../../../ports/outbound/known-affiliation-catalog-configuration.port.js';

const CATALOG_FILE_NAME = 'known-affiliations.yaml';

export class KnownAffiliationCatalogValidationError extends Error {
  public constructor(
    public readonly configurationFilePath: string,
    public readonly fieldPath: string,
    reason: string,
  ) {
    super(
      `Invalid known-affiliation catalog in ${configurationFilePath}: ${fieldPath}: ${reason}`,
    );
    this.name = 'KnownAffiliationCatalogValidationError';
  }
}

@Injectable()
export class KnownAffiliationCatalogConfiguration
  implements IKnownAffiliationCatalogConfigurationPort {
  private readonly catalog: IKnownAffiliationCatalog;

  public constructor() {
    this.catalog = loadKnownAffiliationCatalog();
  }

  public getCatalog(): IKnownAffiliationCatalog {
    return this.catalog;
  }
}

export function loadKnownAffiliationCatalog(): IKnownAffiliationCatalog {
  const configurationFilePath = resolveCatalogFilePath();

  return parseKnownAffiliationCatalog(
    readFileSync(configurationFilePath, 'utf8'),
    configurationFilePath,
  );
}

export function parseKnownAffiliationCatalog(
  content: string,
  configurationFilePath: string,
): IKnownAffiliationCatalog {
  let parsed: unknown;

  try {
    parsed = parse(content);
  } catch (error: unknown) {
    throw validationError(
      configurationFilePath,
      '$',
      error instanceof Error ? error.message : 'must be valid YAML',
    );
  }

  const root = requireRecord(parsed, configurationFilePath, '$');
  const revision = requireString(root.get('revision'), configurationFilePath, 'revision');
  const entries = parseEntries(root.get('entries'), configurationFilePath, 'entries', revision);

  return { entries, revision };
}

function parseEntries(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
  catalogRevision: string,
): readonly IKnownAffiliationCatalogEntry[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw validationError(configurationFilePath, fieldPath, 'must be a non-empty array');
  }

  const entryIds = new Set<string>();
  const aliases = new Set<string>();
  const hosts = new Set<string>();

  return value.map((entryValue, index) => {
    const entryPath = `${fieldPath}[${index}]`;
    const entry = requireRecord(entryValue, configurationFilePath, entryPath);
    const entryId = requireString(entry.get('entryId'), configurationFilePath, `${entryPath}.entryId`);

    if (entryIds.has(entryId)) {
      throw validationError(configurationFilePath, `${entryPath}.entryId`, 'must be unique');
    }

    entryIds.add(entryId);

    const effectiveRevision = requireString(
      entry.get('effectiveRevision'),
      configurationFilePath,
      `${entryPath}.effectiveRevision`,
    );

    if (effectiveRevision !== catalogRevision) {
      throw validationError(
        configurationFilePath,
        `${entryPath}.effectiveRevision`,
        'must equal catalog revision',
      );
    }

    const parsedAliases = parseAliases(
      entry.get('aliases'),
      configurationFilePath,
      `${entryPath}.aliases`,
      aliases,
    );
    const websiteHosts = parseWebsiteHosts(
      entry.get('websiteHosts'),
      configurationFilePath,
      `${entryPath}.websiteHosts`,
      hosts,
    );

    return {
      aliases: parsedAliases,
      effectiveRevision,
      enabled: requireBoolean(entry.get('enabled'), configurationFilePath, `${entryPath}.enabled`),
      entryId,
      ownerLabel: requireString(entry.get('ownerLabel'), configurationFilePath, `${entryPath}.ownerLabel`),
      scopes: parseScopes(entry.get('scopes'), configurationFilePath, `${entryPath}.scopes`),
      sourceUrl: requireHttpsUrl(entry.get('sourceUrl'), configurationFilePath, `${entryPath}.sourceUrl`),
      websiteHosts,
    };
  });
}

function parseAliases(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
  allAliases: Set<string>,
): readonly IKnownAffiliationAlias[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw validationError(configurationFilePath, fieldPath, 'must be a non-empty array');
  }

  return value.map((aliasValue, index) => {
    const aliasPath = `${fieldPath}[${index}]`;
    const alias = requireRecord(aliasValue, configurationFilePath, aliasPath);
    const strategy = requireMatchStrategy(
      alias.get('strategy'),
      configurationFilePath,
      `${aliasPath}.strategy`,
    );

    if (strategy === KNOWN_AFFILIATION_MATCH_STRATEGY.WEBSITE_HOST_OR_SUBDOMAIN) {
      throw validationError(configurationFilePath, `${aliasPath}.strategy`, 'must be a name strategy');
    }

    const valueText = requireString(alias.get('value'), configurationFilePath, `${aliasPath}.value`);
    const key = `${strategy}\u0000${normalizeKnownAffiliationValue(valueText)}`;

    if (allAliases.has(key)) {
      throw validationError(configurationFilePath, aliasPath, 'conflicts with an existing normalized alias');
    }

    allAliases.add(key);

    return {
      evidence: requireEvidence(
        alias.get('evidence'),
        configurationFilePath,
        `${aliasPath}.evidence`,
      ),
      strategy,
      value: valueText,
    };
  });
}

function parseScopes(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): readonly KNOWN_AFFILIATION_SCOPE[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw validationError(configurationFilePath, fieldPath, 'must be a non-empty array');
  }

  const scopes = value.map((scopeValue, index) => requireScope(
    scopeValue,
    configurationFilePath,
    `${fieldPath}[${index}]`,
  ));

  if (new Set(scopes).size !== scopes.length) {
    throw validationError(configurationFilePath, fieldPath, 'must not contain duplicates');
  }

  return scopes;
}

function parseWebsiteHosts(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
  allHosts: Set<string>,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw validationError(configurationFilePath, fieldPath, 'must be an array');
  }

  return value.map((hostValue, index) => {
    const hostPath = `${fieldPath}[${index}]`;
    const host = requireHost(hostValue, configurationFilePath, hostPath);

    if (allHosts.has(host)) {
      throw validationError(configurationFilePath, hostPath, 'conflicts with an existing host');
    }

    allHosts.add(host);

    return host;
  });
}

function requireHost(value: unknown, configurationFilePath: string, fieldPath: string): string {
  const host = requireString(value, configurationFilePath, fieldPath).toLocaleLowerCase('en-US');

  try {
    if (new URL(`https://${host}`).hostname !== host || host.includes('/')) {
      throw new Error('invalid host');
    }
  } catch {
    throw validationError(configurationFilePath, fieldPath, 'must be a valid host name without a path');
  }

  return host;
}

function requireHttpsUrl(value: unknown, configurationFilePath: string, fieldPath: string): string {
  const sourceUrl = requireString(value, configurationFilePath, fieldPath);

  try {
    if (new URL(sourceUrl).protocol !== 'https:') {
      throw new Error('not https');
    }
  } catch {
    throw validationError(configurationFilePath, fieldPath, 'must be a valid HTTPS URL');
  }

  return sourceUrl;
}

function requireBoolean(value: unknown, configurationFilePath: string, fieldPath: string): boolean {
  if (typeof value !== 'boolean') {
    throw validationError(configurationFilePath, fieldPath, 'must be a boolean');
  }

  return value;
}

function requireEvidence(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): KNOWN_AFFILIATION_EVIDENCE {
  if (
    value === KNOWN_AFFILIATION_EVIDENCE.AMBIGUOUS
    || value === KNOWN_AFFILIATION_EVIDENCE.CONFIRMED
  ) {
    return value;
  }

  throw validationError(configurationFilePath, fieldPath, 'must be a supported enum value');
}

function requireMatchStrategy(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): KNOWN_AFFILIATION_MATCH_STRATEGY {
  if (
    value === KNOWN_AFFILIATION_MATCH_STRATEGY.EXACT_NORMALIZED_FULL_NAME
    || value === KNOWN_AFFILIATION_MATCH_STRATEGY.EXACT_TOKEN_SEQUENCE_NAME
    || value === KNOWN_AFFILIATION_MATCH_STRATEGY.WEBSITE_HOST_OR_SUBDOMAIN
  ) {
    return value;
  }

  throw validationError(configurationFilePath, fieldPath, 'must be a supported enum value');
}

function requireScope(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): KNOWN_AFFILIATION_SCOPE {
  if (
    value === KNOWN_AFFILIATION_SCOPE.COLLECTION
    || value === KNOWN_AFFILIATION_SCOPE.FRANCHISE
    || value === KNOWN_AFFILIATION_SCOPE.MANAGEMENT
    || value === KNOWN_AFFILIATION_SCOPE.SOFT_BRAND
  ) {
    return value;
  }

  throw validationError(configurationFilePath, fieldPath, 'must be a supported enum value');
}

function requireRecord(value: unknown, configurationFilePath: string, fieldPath: string): Map<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw validationError(configurationFilePath, fieldPath, 'must be an object');
  }

  return new Map(Object.entries(value));
}

function requireString(value: unknown, configurationFilePath: string, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(configurationFilePath, fieldPath, 'must be a non-empty string');
  }

  return value;
}

function resolveCatalogFilePath(): string {
  const localConfigurationPath = resolve(process.cwd(), '..', 'config', 'qualification', CATALOG_FILE_NAME);
  const containerConfigurationPath = resolve(process.cwd(), 'config', 'qualification', CATALOG_FILE_NAME);

  if (existsSync(localConfigurationPath)) {
    return localConfigurationPath;
  }
  if (existsSync(containerConfigurationPath)) {
    return containerConfigurationPath;
  }

  throw validationError(localConfigurationPath, '$', 'configuration file does not exist');
}

function validationError(
  configurationFilePath: string,
  fieldPath: string,
  reason: string,
): KnownAffiliationCatalogValidationError {
  return new KnownAffiliationCatalogValidationError(configurationFilePath, fieldPath, reason);
}
