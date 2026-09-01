import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'yaml';

import { ApifyGoogleMapsProviderAdapter } from '../../outbound/apify/apify-google-maps-provider-adapter.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import { writeDiscoveryLog } from '../bootstrap/discovery-structured-logger.js';
import { DiscoveryCampaignConfiguration } from '../configuration/discovery-campaign-configuration.js';

const CONTRACT_CAPTURE_MAXIMUM_ITEM_COUNT = 10;
const LIVE_E2E_MAXIMUM_ITEM_COUNT = 20;
const MAXIMUM_PLAN_LIVE_RUN_COUNT = 5;

enum LIVE_PROVIDER_PURPOSE {
  CONTRACT_CAPTURE = 'contract-capture',
  E2E = 'e2e',
}

interface ILiveProviderCaptureConfiguration {
  readonly maximumItemCount: number;
  readonly purpose: LIVE_PROVIDER_PURPOSE;
  readonly scopeId: string;
  readonly searchQueries: readonly string[];
}

async function main(): Promise<void> {
  if (process.argv[2] === 'inspect') {
    await inspectProviderRun(process.argv[3]);

    return;
  }

  const purpose = readPurpose(process.argv[2]);
  const configuration = loadLiveProviderCaptureConfiguration(purpose);
  const maximumItemCount = Math.min(
    configuration.maximumItemCount,
    getPurposeMaximumItemCount(purpose),
  );

  writeDiscoveryLog({
    className: 'CaptureApifyContractCommand',
    correlationId: crypto.randomUUID(),
    input: {
      currentPlanLiveRunCount: 1,
      requestedMaximumPlaces: maximumItemCount,
    },
    level: 'info',
    method: 'main',
    operation: 'live-paid-provider-call',
    message: `Starting ${purpose} provider call`,
    retryable: false,
    service: 'discovery',
  });

  if (MAXIMUM_PLAN_LIVE_RUN_COUNT < 1) {
    throw new Error('plan live-run allowance is exhausted');
  }

  const adapter = new ApifyGoogleMapsProviderAdapter(
    new DiscoveryRuntimeConfiguration(),
    new DiscoveryCampaignConfiguration(),
  );
  const run = await adapter.startProviderRun({
    maximumItemCount,
    scopeId: configuration.scopeId,
    searchQueries: configuration.searchQueries,
  });

  writeDiscoveryLog({
    className: 'CaptureApifyContractCommand',
    correlationId: crypto.randomUUID(),
    input: {
      providerRunId: run.providerRunId,
      requestedMaximumPlaces: maximumItemCount,
    },
    level: 'info',
    method: 'main',
    operation: 'live-paid-provider-call-started',
    message: `Started ${purpose} provider call`,
    retryable: false,
    service: 'discovery',
  });
}

async function inspectProviderRun(providerRunId: string | undefined): Promise<void> {
  if (providerRunId === undefined || providerRunId.trim().length === 0) {
    throw new Error('inspect requires a provider run ID');
  }

  const adapter = new ApifyGoogleMapsProviderAdapter(
    new DiscoveryRuntimeConfiguration(),
    new DiscoveryCampaignConfiguration(),
  );
  const run = await adapter.getRunStatus({ providerRunId });

  if (run.datasetReference === undefined) {
    writeDiscoveryLog({
      className: 'CaptureApifyContractCommand',
      correlationId: crypto.randomUUID(),
      input: { providerRunId, status: run.status },
      level: 'info',
      method: 'inspectProviderRun',
      operation: 'inspect-provider-run',
      message: 'Provider run has no dataset reference yet',
      retryable: false,
      service: 'discovery',
    });

    return;
  }

  const page = await adapter.readProviderResults({
    datasetReference: run.datasetReference,
    limit: CONTRACT_CAPTURE_MAXIMUM_ITEM_COUNT,
    offset: 0,
  });

  writeDiscoveryLog({
    className: 'CaptureApifyContractCommand',
    correlationId: crypto.randomUUID(),
    input: {
      datasetReference: run.datasetReference,
      itemCount: page.items.length,
      items: page.items,
      providerRunId,
      status: run.status,
    },
    level: 'info',
    method: 'inspectProviderRun',
    operation: 'inspect-provider-run',
    message: 'Read provider run dataset through the adapter',
    retryable: false,
    service: 'discovery',
  });
}

function getPurposeMaximumItemCount(purpose: LIVE_PROVIDER_PURPOSE): number {
  return purpose === LIVE_PROVIDER_PURPOSE.CONTRACT_CAPTURE
    ? CONTRACT_CAPTURE_MAXIMUM_ITEM_COUNT
    : LIVE_E2E_MAXIMUM_ITEM_COUNT;
}

function loadLiveProviderCaptureConfiguration(
  purpose: LIVE_PROVIDER_PURPOSE,
): ILiveProviderCaptureConfiguration {
  const configurationFilePath = resolveConfigurationFilePath(purpose);
  const parsed = parse(readFileSync(configurationFilePath, 'utf8'));
  const record = requireRecord(parsed, configurationFilePath);
  const configuredPurpose = requireConfiguredPurpose(
    record.get('purpose'),
    configurationFilePath,
  );

  if (configuredPurpose !== purpose) {
    throw new Error(`${configurationFilePath} has an unexpected purpose`);
  }

  const maximumItemCount = requirePositiveSafeInteger(
    record.get('maximumItemCount'),
    configurationFilePath,
  );

  if (maximumItemCount > getPurposeMaximumItemCount(purpose)) {
    throw new Error(`${configurationFilePath} exceeds its live-provider safety cap`);
  }

  return {
    maximumItemCount,
    purpose,
    scopeId: requireNonEmptyString(record.get('scopeId'), configurationFilePath),
    searchQueries: requireNonEmptyStringArray(
      record.get('searchQueries'),
      configurationFilePath,
    ),
  };
}

function readPurpose(value: string | undefined): LIVE_PROVIDER_PURPOSE {
  if (value === LIVE_PROVIDER_PURPOSE.E2E) {
    return LIVE_PROVIDER_PURPOSE.E2E;
  }

  return LIVE_PROVIDER_PURPOSE.CONTRACT_CAPTURE;
}

function requireConfiguredPurpose(
  value: unknown,
  configurationFilePath: string,
): LIVE_PROVIDER_PURPOSE {
  if (value === LIVE_PROVIDER_PURPOSE.CONTRACT_CAPTURE) {
    return LIVE_PROVIDER_PURPOSE.CONTRACT_CAPTURE;
  }
  if (value === LIVE_PROVIDER_PURPOSE.E2E) {
    return LIVE_PROVIDER_PURPOSE.E2E;
  }

  throw new Error(`${configurationFilePath} has an invalid purpose`);
}

function requireRecord(value: unknown, configurationFilePath: string): Map<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${configurationFilePath} must contain an object`);
  }

  return new Map(Object.entries(value));
}

function requireNonEmptyString(value: unknown, configurationFilePath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${configurationFilePath} must contain a non-empty string`);
  }

  return value;
}

function requireNonEmptyStringArray(
  value: unknown,
  configurationFilePath: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${configurationFilePath} must contain a non-empty string array`);
  }

  return value.map((item) => requireNonEmptyString(item, configurationFilePath));
}

function requirePositiveSafeInteger(value: unknown, configurationFilePath: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${configurationFilePath} must contain a positive safe integer`);
  }

  return value;
}

function resolveConfigurationFilePath(purpose: LIVE_PROVIDER_PURPOSE): string {
  const fileName = `${purpose === LIVE_PROVIDER_PURPOSE.CONTRACT_CAPTURE ? 'contract-capture' : 'live-e2e'}.yaml`;
  const localPath = resolve(process.cwd(), '..', 'config', 'discovery', fileName);
  const containerPath = resolve(process.cwd(), 'config', 'discovery', fileName);

  if (existsSync(localPath)) {
    return localPath;
  }
  if (existsSync(containerPath)) {
    return containerPath;
  }

  throw new Error(`live-provider configuration file does not exist: ${localPath}`);
}

void main();
