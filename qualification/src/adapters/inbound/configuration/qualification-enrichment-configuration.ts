import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { parse } from 'yaml';

import {
  IQualificationEnrichmentConfiguration,
  IQualificationEnrichmentConfigurationPort,
} from '../../../ports/outbound/qualification-enrichment-configuration.port.js';

const CONFIGURATION_FILE_NAME = 'enrichment.yaml';

export class QualificationEnrichmentConfigurationValidationError extends Error {
  public constructor(path: string, field: string, reason: string) {
    super(`Invalid qualification enrichment configuration in ${path}: ${field}: ${reason}`);
    this.name = 'QualificationEnrichmentConfigurationValidationError';
  }
}

@Injectable()
export class QualificationEnrichmentConfiguration
  implements IQualificationEnrichmentConfigurationPort {
  private readonly configurations: ReadonlyMap<string, IQualificationEnrichmentConfiguration>;

  public constructor() {
    this.configurations = loadQualificationEnrichmentConfiguration();
  }

  public getConfiguration(campaignId: string): IQualificationEnrichmentConfiguration {
    const configuration = this.configurations.get(campaignId);

    if (configuration === undefined) {
      throw new Error(`No qualification enrichment configuration exists for campaign: ${campaignId}`);
    }

    return configuration;
  }
}

export function loadQualificationEnrichmentConfiguration(): ReadonlyMap<string, IQualificationEnrichmentConfiguration> {
  const path = resolveConfigurationPath();
  let parsed: unknown;

  try {
    parsed = parse(readFileSync(path, 'utf8'));
  } catch (error: unknown) {
    throw new QualificationEnrichmentConfigurationValidationError(
      path,
      '$',
      error instanceof Error ? error.message : 'must be valid YAML',
    );
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new QualificationEnrichmentConfigurationValidationError(path, '$', 'must be an object');
  }

  const profiles = new Map(Object.entries(parsed)).get('profiles');

  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new QualificationEnrichmentConfigurationValidationError(path, 'profiles', 'must be a non-empty array');
  }

  const configurations = profiles.map((value, index) => parseProfile(value, path, index));

  if (new Set(configurations.map((configuration) => configuration.campaignId)).size !== configurations.length) {
    throw new QualificationEnrichmentConfigurationValidationError(path, 'profiles', 'campaignId must be unique');
  }

  return new Map(configurations.map((configuration) => [configuration.campaignId, configuration]));
}

interface IConfiguredEnrichment extends IQualificationEnrichmentConfiguration {
  readonly campaignId: string;
}

function parseProfile(value: unknown, path: string, index: number): IConfiguredEnrichment {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new QualificationEnrichmentConfigurationValidationError(path, `profiles[${index}]`, 'must be an object');
  }

  const record = new Map(Object.entries(value));
  const integer = (key: string): number => {
    const item = record.get(key);

    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 1) {
      throw new QualificationEnrichmentConfigurationValidationError(path, `profiles[${index}].${key}`, 'must be a positive integer');
    }

    return item;
  };
  const text = (key: string): string => {
    const item = record.get(key);

    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new QualificationEnrichmentConfigurationValidationError(path, `profiles[${index}].${key}`, 'must be a non-empty string');
    }

    return item;
  };
  const enabled = record.get('enabled');
  const amenities = record.get('amenityCatalogue');

  if (typeof enabled !== 'boolean') {
    throw new QualificationEnrichmentConfigurationValidationError(path, `profiles[${index}].enabled`, 'must be a boolean');
  }
  if (!Array.isArray(amenities) || amenities.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new QualificationEnrichmentConfigurationValidationError(path, `profiles[${index}].amenityCatalogue`, 'must be an array of non-empty strings');
  }

  return {
    actorDefinitionId: text('actorDefinitionId'),
    actorRevision: text('actorRevision'),
    amenityCatalogue: amenities.map((item) => typeof item === 'string' ? item.toLowerCase() : ''),
    cachePolicyRevision: text('cachePolicyRevision'),
    campaignId: text('campaignId'),
    currency: text('currency'),
    enabled,
    guests: integer('guests'),
    locale: text('locale'),
    nights: integer('nights'),
  };
}

function resolveConfigurationPath(): string {
  const localPath = resolve(process.cwd(), '..', 'config', 'qualification', CONFIGURATION_FILE_NAME);
  const containerPath = resolve(process.cwd(), 'config', 'qualification', CONFIGURATION_FILE_NAME);

  if (existsSync(localPath)) {
    return localPath;
  }
  if (existsSync(containerPath)) {
    return containerPath;
  }

  throw new QualificationEnrichmentConfigurationValidationError(localPath, '$', 'file does not exist');
}
