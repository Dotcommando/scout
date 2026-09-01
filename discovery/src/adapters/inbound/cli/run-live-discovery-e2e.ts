import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parse } from 'yaml';

import {
  IDiscoveryCampaignConfiguration,
} from '../../../app/discovery/discovery-campaign-configuration.js';
import {
  DISCOVERY_WORK_OUTCOME,
  DiscoveryProgressService,
} from '../../../app/discovery/discovery-progress.service.js';
import {
  DISCOVERY_SCOPE_STATUS,
} from '../../../domain/discovery/discovery-model.js';
import { IDiscoveryCampaignConfigurationPort } from '../../../ports/outbound/discovery-campaign-configuration.port.js';
import { ApifyGoogleMapsProviderAdapter } from '../../outbound/apify/apify-google-maps-provider-adapter.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoDiscoveryOutputRepository } from '../../outbound/mongodb/mongo-discovery-output-repository.js';
import { MongoDiscoveryStateRepository } from '../../outbound/mongodb/mongo-discovery-state-repository.js';
import { MongoLeadRepository } from '../../outbound/mongodb/mongo-lead-repository.js';
import { MongoProviderQuotaRepository } from '../../outbound/mongodb/mongo-provider-quota-repository.js';
import { SystemClock } from '../../outbound/time/system-clock.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import { writeDiscoveryLog } from '../bootstrap/discovery-structured-logger.js';
import { DiscoveryCampaignConfiguration } from '../configuration/discovery-campaign-configuration.js';

const LIVE_E2E_MAXIMUM_ITEM_COUNT = 20;
const LIVE_E2E_POLL_INTERVAL_MILLISECONDS = 5_000;
const LIVE_E2E_MAXIMUM_POLL_COUNT = 60;
const LIVE_E2E_PLAN_RUN_COUNT = 2;

interface ILiveE2eConfiguration {
  readonly maximumItemCount: number;
  readonly scopeId: string;
  readonly searchQueries: readonly string[];
}

async function main(): Promise<void> {
  const liveConfiguration = loadLiveE2eConfiguration();
  const runtimeConfiguration = new DiscoveryRuntimeConfiguration();
  const sourceCampaignConfiguration = new DiscoveryCampaignConfiguration();
  const e2eCampaignConfiguration = new LiveE2eCampaignConfiguration(
    sourceCampaignConfiguration.value,
    liveConfiguration,
  );
  const databaseClient = new MongoDatabaseClient(runtimeConfiguration);

  await databaseClient.onModuleInit();

  try {
    const scopeRepository = new MongoDiscoveryStateRepository(databaseClient);
    const outputRepository = new MongoDiscoveryOutputRepository(databaseClient);
    const leadRepository = new MongoLeadRepository(databaseClient);
    const quotaRepository = new MongoProviderQuotaRepository(databaseClient);

    await Promise.all([
      scopeRepository.onModuleInit(),
      outputRepository.onModuleInit(),
      leadRepository.onModuleInit(),
      quotaRepository.onModuleInit(),
    ]);

    const provider = new ApifyGoogleMapsProviderAdapter(
      runtimeConfiguration,
      sourceCampaignConfiguration,
    );
    const createService = (): DiscoveryProgressService =>
      new DiscoveryProgressService(
        e2eCampaignConfiguration,
        new SystemClock(),
        outputRepository,
        provider,
        leadRepository,
        scopeRepository,
        quotaRepository,
      );
    let service = createService();

    writeDiscoveryLog({
      campaignId: e2eCampaignConfiguration.value.campaignId,
      className: 'RunLiveDiscoveryE2eCommand',
      correlationId: crypto.randomUUID(),
      input: {
        currentPlanLiveRunCount: LIVE_E2E_PLAN_RUN_COUNT,
        requestedMaximumPlaces: liveConfiguration.maximumItemCount,
        scopeId: liveConfiguration.scopeId,
      },
      level: 'info',
      method: 'main',
      operation: 'live-paid-provider-call',
      message: 'Starting live Discovery E2E provider call',
      retryable: false,
      service: 'discovery',
      sourceKind: e2eCampaignConfiguration.value.source.kind,
      scopeId: liveConfiguration.scopeId,
    });

    const startResult = await service.advanceDiscoveryWork(createInput());

    if (startResult.outcome !== DISCOVERY_WORK_OUTCOME.PROVIDER_RUN_STARTED) {
      throw new Error(`live E2E did not start a provider run: ${startResult.outcome}`);
    }

    let completed = false;

    for (let pollCount = 0; pollCount < LIVE_E2E_MAXIMUM_POLL_COUNT; pollCount += 1) {
      await waitForNextPoll();

      if (pollCount === 0) {
        service = createService();
      }

      const result = await service.advanceDiscoveryWork(createInput());

      writeDiscoveryLog({
        campaignId: e2eCampaignConfiguration.value.campaignId,
        className: 'RunLiveDiscoveryE2eCommand',
        correlationId: crypto.randomUUID(),
        input: { pollCount: pollCount + 1, result },
        level: 'info',
        method: 'main',
        operation: 'poll-live-discovery-e2e',
        retryable: false,
        service: 'discovery',
        sourceKind: e2eCampaignConfiguration.value.source.kind,
        scopeId: liveConfiguration.scopeId,
      });

      if (result.outcome === DISCOVERY_WORK_OUTCOME.IMPORT_COMPLETED) {
        completed = true;

        break;
      }
    }

    if (!completed) {
      throw new Error('live E2E provider run did not complete within the poll limit');
    }

    const completedScope = await scopeRepository.findScopeProgress(
      e2eCampaignConfiguration.value.campaignId,
      liveConfiguration.scopeId,
    );

    if (completedScope?.status !== DISCOVERY_SCOPE_STATUS.DONE) {
      throw new Error('live E2E scope did not persist the Done state');
    }

    const outputCount = await databaseClient
      .getDatabase()
      .collection('discovery_outputs')
      .countDocuments({ campaignId: e2eCampaignConfiguration.value.campaignId });

    writeDiscoveryLog({
      campaignId: e2eCampaignConfiguration.value.campaignId,
      className: 'RunLiveDiscoveryE2eCommand',
      correlationId: crypto.randomUUID(),
      input: {
        outputCount,
        providerRunId: completedScope.providerRun?.providerRunId,
        scopeId: completedScope.scopeId,
      },
      level: 'info',
      method: 'main',
      operation: 'complete-live-discovery-e2e',
      message: 'Completed live Discovery E2E flow',
      retryable: false,
      service: 'discovery',
      sourceKind: e2eCampaignConfiguration.value.source.kind,
      scopeId: completedScope.scopeId,
    });
  } finally {
    await databaseClient.onModuleDestroy();
  }
}

class LiveE2eCampaignConfiguration
  implements IDiscoveryCampaignConfigurationPort {
  public readonly value: IDiscoveryCampaignConfiguration;

  public constructor(
    sourceConfiguration: IDiscoveryCampaignConfiguration,
    liveConfiguration: ILiveE2eConfiguration,
  ) {
    this.value = {
      ...sourceConfiguration,
      campaignId: `${sourceConfiguration.campaignId}-live-e2e`,
      configurationHash: `${sourceConfiguration.configurationHash}-live-e2e`,
      limits: {
        dailyProviderItemLimit: LIVE_E2E_MAXIMUM_ITEM_COUNT,
        maxProviderItemsPerRun: LIVE_E2E_MAXIMUM_ITEM_COUNT,
      },
      scopes: [
        {
          id: liveConfiguration.scopeId,
          label: liveConfiguration.scopeId,
          priority: 1,
        },
      ],
      searchQueries: liveConfiguration.searchQueries,
    };
  }

  public getCampaignConfiguration(): IDiscoveryCampaignConfiguration {
    return this.value;
  }
}

function createInput() {
  return {
    correlationId: crypto.randomUUID(),
    workerId: `live-e2e-${process.pid}`,
  };
}

function loadLiveE2eConfiguration(): ILiveE2eConfiguration {
  const configurationFilePath = resolveLiveE2eConfigurationPath();
  const parsed = parse(readFileSync(configurationFilePath, 'utf8'));
  const record = requireRecord(parsed, configurationFilePath);
  const maximumItemCount = requirePositiveSafeInteger(
    record.get('maximumItemCount'),
    configurationFilePath,
  );

  if (maximumItemCount > LIVE_E2E_MAXIMUM_ITEM_COUNT) {
    throw new Error(`${configurationFilePath} exceeds the live E2E safety cap`);
  }
  if (record.get('purpose') !== 'e2e') {
    throw new Error(`${configurationFilePath} must declare the e2e purpose`);
  }

  return {
    maximumItemCount,
    scopeId: requireNonEmptyString(record.get('scopeId'), configurationFilePath),
    searchQueries: requireNonEmptyStringArray(
      record.get('searchQueries'),
      configurationFilePath,
    ),
  };
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

function resolveLiveE2eConfigurationPath(): string {
  const fileName = 'live-e2e.yaml';
  const localPath = resolve(process.cwd(), '..', 'config', 'discovery', fileName);
  const containerPath = resolve(process.cwd(), 'config', 'discovery', fileName);

  if (existsSync(localPath)) {
    return localPath;
  }
  if (existsSync(containerPath)) {
    return containerPath;
  }

  throw new Error(`live E2E configuration file does not exist: ${localPath}`);
}

function waitForNextPoll(): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, LIVE_E2E_POLL_INTERVAL_MILLISECONDS);
  });
}

void main();
