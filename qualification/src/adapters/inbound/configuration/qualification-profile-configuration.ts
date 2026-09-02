import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { parse } from 'yaml';

import { IQualificationProfileConfiguration } from '../../../app/qualification/qualification-profile-configuration.js';
import {
  IQualificationProfile,
  IQualificationRequirements,
  ISourceIdentityExclusion,
} from '../../../domain/qualification/qualification-model.js';
import { IQualificationProfileConfigurationPort } from '../../../ports/outbound/qualification-profile-configuration.port.js';

const QUALIFICATION_CONFIGURATION_FILE_NAME = 'profiles.yaml';

export class QualificationProfileConfigurationValidationError extends Error {
  public constructor(
    public readonly configurationFilePath: string,
    public readonly fieldPath: string,
    reason: string,
  ) {
    super(
      `Invalid Qualification profile configuration in ${configurationFilePath}: ${fieldPath}: ${reason}`,
    );
    this.name = 'QualificationProfileConfigurationValidationError';
  }
}

@Injectable()
export class QualificationProfileConfiguration
  implements IQualificationProfileConfigurationPort {
  private readonly value: IQualificationProfileConfiguration;

  public constructor() {
    this.value = loadQualificationProfileConfiguration();
  }

  public getProfile(campaignId: string): IQualificationProfile {
    const profile = this.value.profiles.find(
      (candidate) => candidate.campaignId === campaignId,
    );

    if (profile === undefined) {
      throw new QualificationProfileConfigurationValidationError(
        resolveConfigurationFilePath(),
        'profiles',
        `does not define a profile for campaignId ${campaignId}`,
      );
    }

    return profile;
  }
}

export function loadQualificationProfileConfiguration(): IQualificationProfileConfiguration {
  const configurationFilePath = resolveConfigurationFilePath();
  const content = readFileSync(configurationFilePath, 'utf8');

  return parseQualificationProfileConfiguration(content, configurationFilePath);
}

export function parseQualificationProfileConfiguration(
  content: string,
  configurationFilePath: string,
): IQualificationProfileConfiguration {
  let parsed: unknown;

  try {
    parsed = parse(content);
  } catch (error: unknown) {
    throw new QualificationProfileConfigurationValidationError(
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
  const profiles = parseProfiles(
    root.get('profiles'),
    configurationFilePath,
    'profiles',
  );

  return {
    configurationHash: createHash('sha256').update(content).digest('hex'),
    profiles,
    version,
  };
}

function parseProfiles(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): readonly IQualificationProfile[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new QualificationProfileConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be a non-empty array',
    );
  }

  const campaignIds = new Set<string>();

  return value.map((profileValue, index) => {
    const profilePath = `${fieldPath}[${index}]`;
    const profile = requireRecord(
      profileValue,
      configurationFilePath,
      profilePath,
    );
    const campaignId = requireString(
      profile.get('campaignId'),
      configurationFilePath,
      `${profilePath}.campaignId`,
    );

    if (campaignIds.has(campaignId)) {
      throw new QualificationProfileConfigurationValidationError(
        configurationFilePath,
        `${profilePath}.campaignId`,
        'must be unique',
      );
    }

    campaignIds.add(campaignId);

    const profileId = requireString(
      profile.get('profileId'),
      configurationFilePath,
      `${profilePath}.profileId`,
    );
    const profileVersion = requirePositiveInteger(
      profile.get('profileVersion'),
      configurationFilePath,
      `${profilePath}.profileVersion`,
    );
    const requirements = parseRequirements(
      profile.get('requirements'),
      configurationFilePath,
      `${profilePath}.requirements`,
    );
    const excludedSourceIdentities = parseExcludedSourceIdentities(
      profile.get('excludedSourceIdentities'),
      configurationFilePath,
      `${profilePath}.excludedSourceIdentities`,
    );
    const excludedWebsiteHosts = parseWebsiteHosts(
      profile.get('excludedWebsiteHosts'),
      configurationFilePath,
      `${profilePath}.excludedWebsiteHosts`,
    );

    return {
      campaignId,
      contentHash: createProfileContentHash(
        campaignId,
        excludedSourceIdentities,
        excludedWebsiteHosts,
        profileId,
        requirements,
        profileVersion,
      ),
      excludedSourceIdentities,
      excludedWebsiteHosts,
      profileId,
      requirements,
      version: profileVersion,
    };
  });
}

function createProfileContentHash(
  campaignId: string,
  excludedSourceIdentities: readonly ISourceIdentityExclusion[],
  excludedWebsiteHosts: readonly string[],
  profileId: string,
  requirements: IQualificationRequirements,
  version: number,
): string {
  const canonicalContent = JSON.stringify({
    campaignId,
    excludedSourceIdentities: [...excludedSourceIdentities].sort(
      (left, right) => `${left.sourceKind}\u0000${left.externalId}`.localeCompare(
        `${right.sourceKind}\u0000${right.externalId}`,
      ),
    ),
    excludedWebsiteHosts: [...excludedWebsiteHosts].sort(),
    profileId,
    requirements,
    version,
  });

  return createHash('sha256').update(canonicalContent).digest('hex');
}

function parseRequirements(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): IQualificationRequirements {
  const requirements = requireRecord(value, configurationFilePath, fieldPath);

  return {
    address: requireBoolean(
      requirements.get('address'),
      configurationFilePath,
      `${fieldPath}.address`,
    ),
    name: requireBoolean(
      requirements.get('name'),
      configurationFilePath,
      `${fieldPath}.name`,
    ),
    phoneNumber: requireBoolean(
      requirements.get('phoneNumber'),
      configurationFilePath,
      `${fieldPath}.phoneNumber`,
    ),
    websiteUrl: requireBoolean(
      requirements.get('websiteUrl'),
      configurationFilePath,
      `${fieldPath}.websiteUrl`,
    ),
  };
}

function parseExcludedSourceIdentities(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): readonly ISourceIdentityExclusion[] {
  if (!Array.isArray(value)) {
    throw new QualificationProfileConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be an array',
    );
  }

  const identities = new Set<string>();

  return value.map((identityValue, index) => {
    const identityPath = `${fieldPath}[${index}]`;
    const identity = requireRecord(
      identityValue,
      configurationFilePath,
      identityPath,
    );
    const externalId = requireString(
      identity.get('externalId'),
      configurationFilePath,
      `${identityPath}.externalId`,
    );
    const sourceKind = requireString(
      identity.get('sourceKind'),
      configurationFilePath,
      `${identityPath}.sourceKind`,
    );
    const key = `${sourceKind}\u0000${externalId}`;

    if (identities.has(key)) {
      throw new QualificationProfileConfigurationValidationError(
        configurationFilePath,
        identityPath,
        'must not contain duplicate source identities',
      );
    }

    identities.add(key);

    return { externalId, sourceKind };
  });
}

function parseWebsiteHosts(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new QualificationProfileConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be an array',
    );
  }

  const hosts = new Set<string>();

  return value.map((hostValue, index) => {
    const host = requireString(
      hostValue,
      configurationFilePath,
      `${fieldPath}[${index}]`,
    ).toLowerCase();

    if (hosts.has(host)) {
      throw new QualificationProfileConfigurationValidationError(
        configurationFilePath,
        `${fieldPath}[${index}]`,
        'must be unique case-insensitively',
      );
    }

    hosts.add(host);

    return host;
  });
}

function requireBoolean(
  value: unknown,
  configurationFilePath: string,
  fieldPath: string,
): boolean {
  if (typeof value !== 'boolean') {
    throw new QualificationProfileConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be a boolean',
    );
  }

  return value;
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
    throw new QualificationProfileConfigurationValidationError(
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
    throw new QualificationProfileConfigurationValidationError(
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
    throw new QualificationProfileConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be a non-empty string',
    );
  }

  return value;
}

function resolveConfigurationFilePath(): string {
  const localConfigurationPath = resolve(
    process.cwd(),
    '..',
    'config',
    'qualification',
    QUALIFICATION_CONFIGURATION_FILE_NAME,
  );
  const containerConfigurationPath = resolve(
    process.cwd(),
    'config',
    'qualification',
    QUALIFICATION_CONFIGURATION_FILE_NAME,
  );

  if (existsSync(localConfigurationPath)) {
    return localConfigurationPath;
  }
  if (existsSync(containerConfigurationPath)) {
    return containerConfigurationPath;
  }

  throw new QualificationProfileConfigurationValidationError(
    localConfigurationPath,
    '$',
    'configuration file does not exist',
  );
}
