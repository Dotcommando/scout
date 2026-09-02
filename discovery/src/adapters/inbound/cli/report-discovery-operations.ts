import { Collection, Document } from 'mongodb';

import {
  DISCOVERY_BACKFILL_RUN_STATUS,
  DISCOVERY_OUTPUT_STATUS,
} from '../../../domain/discovery/discovery-model.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import {
  writeDiscoveryFailureLog,
  writeDiscoveryLog,
} from '../bootstrap/discovery-structured-logger.js';

interface IStatusCount {
  readonly count: number;
  readonly status: string;
}

async function main(): Promise<void> {
  const correlationId = crypto.randomUUID();
  const databaseClient = new MongoDatabaseClient(
    new DiscoveryRuntimeConfiguration(),
  );

  await databaseClient.onModuleInit();

  try {
    const database = databaseClient.getDatabase();
    const [backfillRuns, outputs] = await Promise.all([
      countByStatus(
        database.collection('discovery_backfill_runs'),
        DISCOVERY_BACKFILL_RUN_STATUS_ARRAY,
      ),
      countByStatus(
        database.collection('discovery_outputs'),
        DISCOVERY_OUTPUT_STATUS_ARRAY,
      ),
    ]);

    writeDiscoveryLog({
      className: 'ReportDiscoveryOperationsCommand',
      correlationId,
      input: { backfillRuns, outputs },
      level: 'info',
      method: 'main',
      operation: 'report-discovery-operations',
      retryable: false,
      service: 'discovery',
    });
  } finally {
    await databaseClient.onModuleDestroy();
  }
}

const DISCOVERY_BACKFILL_RUN_STATUS_ARRAY = Object.values(
  DISCOVERY_BACKFILL_RUN_STATUS,
);
const DISCOVERY_OUTPUT_STATUS_ARRAY = Object.values(DISCOVERY_OUTPUT_STATUS);

async function countByStatus(
  collection: Collection<Document>,
  statuses: readonly string[],
): Promise<readonly IStatusCount[]> {
  return Promise.all(
    statuses.map(async (status) => ({
      count: await collection.countDocuments({ status }),
      status,
    })),
  );
}

void main().catch((error: unknown) => {
  writeDiscoveryFailureLog({
    className: 'ReportDiscoveryOperationsCommand',
    correlationId: crypto.randomUUID(),
    error,
    method: 'main',
    operation: 'report-discovery-operations',
    retryable: true,
  });
  process.exitCode = 1;
});
