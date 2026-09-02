import { DiscoveryBackfillService } from '../../../app/discovery/discovery-backfill.service.js';
import { DISCOVERY_SOURCE_KIND } from '../../../domain/discovery/discovery-model.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoDiscoveryBackfillRunRepository } from '../../outbound/mongodb/mongo-discovery-backfill-run-repository.js';
import { MongoDiscoveryOutputRepository } from '../../outbound/mongodb/mongo-discovery-output-repository.js';
import { MongoLeadRepository } from '../../outbound/mongodb/mongo-lead-repository.js';
import { SystemClock } from '../../outbound/time/system-clock.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import {
  writeDiscoveryFailureLog,
  writeDiscoveryLog,
} from '../bootstrap/discovery-structured-logger.js';
import { DiscoveryCampaignConfiguration } from '../configuration/discovery-campaign-configuration.js';

export interface IDiscoveryBackfillCommand {
  readonly campaignId: string;
  readonly confirmed: boolean;
  readonly dryRun: boolean;
  readonly leadIdPrefix?: string;
  readonly maximumLeadCount: number;
  readonly qualificationCatalogRevision: string;
  readonly runId: string;
  readonly sourceKind: DISCOVERY_SOURCE_KIND;
}

async function main(): Promise<void> {
  const command = parseDiscoveryBackfillCommand(process.argv.slice(2));
  const correlationId = crypto.randomUUID();
  const runtimeConfiguration = new DiscoveryRuntimeConfiguration();
  const campaignConfiguration = new DiscoveryCampaignConfiguration();
  const databaseClient = new MongoDatabaseClient(runtimeConfiguration);

  await databaseClient.onModuleInit();

  try {
    const backfillRunRepository = new MongoDiscoveryBackfillRunRepository(databaseClient);
    const discoveryOutputRepository = new MongoDiscoveryOutputRepository(databaseClient);
    const leadRepository = new MongoLeadRepository(databaseClient);

    await Promise.all([
      backfillRunRepository.onModuleInit(),
      discoveryOutputRepository.onModuleInit(),
      leadRepository.onModuleInit(),
    ]);

    const service = new DiscoveryBackfillService(
      campaignConfiguration,
      new SystemClock(),
      backfillRunRepository,
      discoveryOutputRepository,
      leadRepository,
    );
    const result = await service.runBackfill({
      ...command,
      correlationId,
    });

    writeDiscoveryLog({
      campaignId: command.campaignId,
      className: 'RunDiscoveryBackfillCommand',
      correlationId,
      input: {
        dryRun: command.dryRun,
        maximumLeadCount: command.maximumLeadCount,
        ...(command.leadIdPrefix === undefined
          ? {}
          : { leadIdPrefix: command.leadIdPrefix }),
        qualificationCatalogRevision: command.qualificationCatalogRevision,
        runId: command.runId,
        sourceKind: command.sourceKind,
      },
      level: 'info',
      message: 'Discovery backfill completed through the outbox',
      method: 'main',
      operation: 'backfill-discovery-leads',
      retryable: false,
      service: 'discovery',
      sourceKind: command.sourceKind,
    });
    writeDiscoveryLog({
      campaignId: command.campaignId,
      className: 'RunDiscoveryBackfillCommand',
      correlationId,
      input: result,
      level: 'info',
      method: 'main',
      operation: 'backfill-discovery-leads-result',
      retryable: false,
      service: 'discovery',
      sourceKind: command.sourceKind,
    });
  } finally {
    await databaseClient.onModuleDestroy();
  }
}

export function parseDiscoveryBackfillCommand(
  argumentsList: readonly string[],
): IDiscoveryBackfillCommand {
  const values = new Map<string, string>();
  let confirmed = false;
  let dryRun = false;

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];

    if (argument === '--confirm') {
      confirmed = true;

      continue;
    }
    if (argument === '--dry-run') {
      dryRun = true;

      continue;
    }
    if (!isValueOption(argument)) {
      throw new Error(`unsupported backfill argument ${argument ?? ''}`);
    }

    const value = argumentsList[index + 1];

    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    if (values.has(argument)) {
      throw new Error(`${argument} must be provided once`);
    }

    values.set(argument, value);
    index += 1;
  }

  const sourceKind = readSourceKind(requireValue(values, '--source-kind'));

  return {
    campaignId: requireValue(values, '--campaign-id'),
    confirmed,
    dryRun,
    ...(values.has('--lead-id-prefix')
      ? { leadIdPrefix: requireValue(values, '--lead-id-prefix') }
      : {}),
    maximumLeadCount: readPositiveSafeInteger(
      requireValue(values, '--maximum-lead-count'),
      '--maximum-lead-count',
    ),
    qualificationCatalogRevision: requireValue(
      values,
      '--qualification-catalog-revision',
    ),
    runId: requireValue(values, '--run-id'),
    sourceKind,
  };
}

function isValueOption(value: string | undefined): boolean {
  return value === '--campaign-id'
    || value === '--maximum-lead-count'
    || value === '--lead-id-prefix'
    || value === '--qualification-catalog-revision'
    || value === '--run-id'
    || value === '--source-kind';
}

function readPositiveSafeInteger(value: string, optionName: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive safe integer`);
  }

  return parsed;
}

function readSourceKind(value: string): DISCOVERY_SOURCE_KIND {
  if (value === DISCOVERY_SOURCE_KIND.GOOGLE_MAPS) {
    return DISCOVERY_SOURCE_KIND.GOOGLE_MAPS;
  }

  throw new Error('--source-kind is invalid');
}

function requireValue(values: Map<string, string>, optionName: string): string {
  const value = values.get(optionName);

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${optionName} is required`);
  }

  return value;
}

void main().catch((error: unknown) => {
  writeDiscoveryFailureLog({
    className: 'RunDiscoveryBackfillCommand',
    correlationId: crypto.randomUUID(),
    error,
    method: 'main',
    operation: 'backfill-discovery-leads',
    retryable: false,
  });
  process.exitCode = 1;
});
