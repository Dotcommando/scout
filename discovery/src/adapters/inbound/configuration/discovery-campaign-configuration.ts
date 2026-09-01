import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { parse } from 'yaml';

import {
  IDiscoveryCampaignConfiguration,
  IDiscoveryCampaignLimits,
  IDiscoveryScopeConfiguration,
  IDiscoverySourceConfiguration,
} from '../../../app/discovery/discovery-campaign-configuration.js';
import { DISCOVERY_SOURCE_KIND } from '../../../domain/discovery/discovery-model.js';

const CAMPAIGN_CONFIGURATION_FILE_NAME = 'campaign.yaml';

export class CampaignConfigurationValidationError extends Error {
  public constructor(
    public readonly configurationFilePath: string,
    public readonly fieldPath: string,
    reason: string,
  ) {
    super(
      `Invalid Discovery campaign configuration in ${configurationFilePath}: ${fieldPath}: ${reason}`,
    );
    this.name = 'CampaignConfigurationValidationError';
  }
}

@Injectable()
export class DiscoveryCampaignConfiguration {
  public readonly value: IDiscoveryCampaignConfiguration;

  public constructor() {
    this.value = loadDiscoveryCampaignConfiguration();
  }
}

export function loadDiscoveryCampaignConfiguration(): IDiscoveryCampaignConfiguration {
  const configurationFilePath = resolveConfigurationFilePath();
  const content = readFileSync(configurationFilePath, 'utf8');

  return parseDiscoveryCampaignConfiguration(content, configurationFilePath);
}

export function parseDiscoveryCampaignConfiguration(
  content: string,
  configurationFilePath: string,
): IDiscoveryCampaignConfiguration {
  let parsed: unknown;

  try {
    parsed = parse(content);
  } catch (error: unknown) {
    throw new CampaignConfigurationValidationError(
      configurationFilePath,
      '$',
      error instanceof Error ? error.message : 'must be valid YAML',
    );
  }

  const root = requireRecord(parsed, configurationFilePath, '$');
  const version = requirePositiveInteger(
    root.get('version'),
    configurationFilePath,
    'version',
  );
  const campaignId = requireString(
    root.get('campaignId'),
    configurationFilePath,
    'campaignId',
  );
  const source = parseSource(
    root.get('source'),
    configurationFilePath,
    'source',
  );
  const searchQueries = requireStringArray(
    root.get('searchQueries'),
    configurationFilePath,
    'searchQueries',
  );
  const scopes = parseScopes(
    root.get('scopes'),
    configurationFilePath,
    'scopes',
  );
  const limits = parseLimits(
    root.get('limits'),
    configurationFilePath,
    'limits',
  );

  if (limits.maxProviderItemsPerRun > limits.dailyProviderItemLimit) {
    throw new CampaignConfigurationValidationError(
      configurationFilePath,
      'limits.maxProviderItemsPerRun',
      'must not exceed limits.dailyProviderItemLimit',
    );
  }

  return {
    campaignId,
    configurationHash: createHash('sha256').update(content).digest('hex'),
    limits,
    scopes,
    searchQueries,
    source,
    version,
  };
}

function parseLimits(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): IDiscoveryCampaignLimits {
  const record = requireRecord(value, configurationFilePath, fieldPath);

  return {
    dailyProviderItemLimit: requirePositiveInteger(
      record.get('dailyProviderItemLimit'),
      configurationFilePath,
      `${fieldPath}.dailyProviderItemLimit`,
    ),
    maxProviderItemsPerRun: requirePositiveInteger(
      record.get('maxProviderItemsPerRun'),
      configurationFilePath,
      `${fieldPath}.maxProviderItemsPerRun`,
    ),
  };
}

function parseScopes(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): readonly IDiscoveryScopeConfiguration[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CampaignConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be a non-empty array',
    );
  }

  const scopeIds = new Set<string>();

  return value.map((scopeValue, index) => {
    const scopePath = `${fieldPath}[${index}]`;
    const scope = requireRecord(scopeValue, configurationFilePath, scopePath);
    const id = requireString(scope.get('id'), configurationFilePath, `${scopePath}.id`);

    if (scopeIds.has(id)) {
      throw new CampaignConfigurationValidationError(
        configurationFilePath,
        `${scopePath}.id`,
        'must be unique',
      );
    }

    scopeIds.add(id);

    return {
      id,
      label: requireString(
        scope.get('label'),
        configurationFilePath,
        `${scopePath}.label`,
      ),
      priority: requirePositiveInteger(
        scope.get('priority'),
        configurationFilePath,
        `${scopePath}.priority`,
      ),
    };
  });
}

function parseSource(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): IDiscoverySourceConfiguration {
  const source = requireRecord(value, configurationFilePath, fieldPath);
  const kindValue = requireString(
    source.get('kind'),
    configurationFilePath,
    `${fieldPath}.kind`,
  );

  if (kindValue !== DISCOVERY_SOURCE_KIND.GOOGLE_MAPS) {
    throw new CampaignConfigurationValidationError(
      configurationFilePath,
      `${fieldPath}.kind`,
      'must be google-maps',
    );
  }

  return {
    actorId: requireString(
      source.get('actorId'),
      configurationFilePath,
      `${fieldPath}.actorId`,
    ),
    kind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
  };
}

function requirePositiveInteger(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 1
  ) {
    throw new CampaignConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be a positive safe integer',
    );
  }

  return value;
}

function requireRecord(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): Map<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new CampaignConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be an object',
    );
  }

  return new Map(Object.entries(value));
}

function requireString(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CampaignConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be a non-empty string',
    );
  }

  return value;
}

function requireStringArray(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CampaignConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be a non-empty array',
    );
  }

  return value.map((item, index) =>
    requireString(item, configurationFilePath, `${fieldPath}[${index}]`),
  );
}

function resolveConfigurationFilePath(): string {
  const localConfigurationPath = resolve(
    process.cwd(),
    '..',
    'config',
    'discovery',
    CAMPAIGN_CONFIGURATION_FILE_NAME,
  );
  const containerConfigurationPath = resolve(
    process.cwd(),
    'config',
    'discovery',
    CAMPAIGN_CONFIGURATION_FILE_NAME,
  );

  if (existsSync(localConfigurationPath)) {
    return localConfigurationPath;
  }
  if (existsSync(containerConfigurationPath)) {
    return containerConfigurationPath;
  }

  throw new CampaignConfigurationValidationError(
    localConfigurationPath,
    '$',
    'configuration file does not exist',
  );
}
