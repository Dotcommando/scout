import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { parse } from 'yaml';

import { ILiveDiscoveryExecutionConfiguration } from '../../../app/discovery/live-discovery-execution-configuration.js';
import { ILiveDiscoveryExecutionConfigurationPort } from '../../../ports/outbound/live-discovery-execution-configuration.port.js';

const CONFIGURATION_FILE_NAME = 'live-execution.yaml';

@Injectable()
export class LiveDiscoveryExecutionConfiguration
  implements ILiveDiscoveryExecutionConfigurationPort {
  private readonly configuration: ILiveDiscoveryExecutionConfiguration;

  public constructor() {
    this.configuration = loadLiveDiscoveryExecutionConfiguration();
  }

  public getLiveExecutionConfiguration(): ILiveDiscoveryExecutionConfiguration {
    return this.configuration;
  }
}

export function loadLiveDiscoveryExecutionConfiguration(): ILiveDiscoveryExecutionConfiguration {
  const filePath = resolveConfigurationFilePath();
  const value = parse(readFileSync(filePath, 'utf8'));

  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${filePath} must contain an object`);
  }

  const record = new Map(Object.entries(value));
  const configuration = {
    maximumPlanProviderItems: requirePositiveInteger(record, filePath, 'maximumPlanProviderItems'),
    maximumPlanProviderRuns: requirePositiveInteger(record, filePath, 'maximumPlanProviderRuns'),
    maximumProviderItemsPerRun: requirePositiveInteger(record, filePath, 'maximumProviderItemsPerRun'),
    minimumUniqueLeadRate: requireRate(record, filePath, 'minimumUniqueLeadRate'),
    minimumYieldEvaluationProviderItems: requirePositiveInteger(record, filePath, 'minimumYieldEvaluationProviderItems'),
    planId: requireString(record, filePath, 'planId'),
    preflightMaximumProviderItems: requirePositiveInteger(record, filePath, 'preflightMaximumProviderItems'),
    version: requirePositiveInteger(record, filePath, 'version'),
  };

  if (configuration.maximumPlanProviderItems !== 600 || configuration.maximumPlanProviderRuns !== 7) {
    throw new Error(`${filePath} must preserve the plan limits of 600 provider items and 7 runs`);
  }
  if (configuration.maximumProviderItemsPerRun > 100) {
    throw new Error(`${filePath} maximumProviderItemsPerRun must not exceed 100`);
  }
  if (configuration.preflightMaximumProviderItems > 20) {
    throw new Error(`${filePath} preflightMaximumProviderItems must not exceed 20`);
  }

  return configuration;
}

function requirePositiveInteger(record: Map<string, unknown>, filePath: string, field: string): number {
  const value = record.get(field);

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${filePath} ${field} must be a positive safe integer`);
  }

  return value;
}

function requireRate(record: Map<string, unknown>, filePath: string, field: string): number {
  const value = record.get(field);

  if (typeof value !== 'number' || value < 0 || value > 1) {
    throw new Error(`${filePath} ${field} must be a number between zero and one`);
  }

  return value;
}

function requireString(record: Map<string, unknown>, filePath: string, field: string): string {
  const value = record.get(field);

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${filePath} ${field} must be a non-empty string`);
  }

  return value;
}

function resolveConfigurationFilePath(): string {
  const localPath = resolve(process.cwd(), '..', 'config', 'discovery', CONFIGURATION_FILE_NAME);
  const containerPath = resolve(process.cwd(), 'config', 'discovery', CONFIGURATION_FILE_NAME);

  if (existsSync(localPath)) {
    return localPath;
  }
  if (existsSync(containerPath)) {
    return containerPath;
  }

  throw new Error(`${localPath} does not exist`);
}
