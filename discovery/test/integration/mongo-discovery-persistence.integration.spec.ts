import { randomUUID } from 'node:crypto';

import { DiscoveryRuntimeConfiguration } from '../../src/adapters/inbound/bootstrap/discovery-runtime-configuration.js';
import { MongoDatabaseClient } from '../../src/adapters/outbound/mongodb/mongo-database-client.js';
import { MongoDiscoveryStateRepository } from '../../src/adapters/outbound/mongodb/mongo-discovery-state-repository.js';
import { MongoLeadRepository } from '../../src/adapters/outbound/mongodb/mongo-lead-repository.js';
import { MongoProviderQuotaRepository } from '../../src/adapters/outbound/mongodb/mongo-provider-quota-repository.js';
import {
  DISCOVERY_SCOPE_STATUS,
  DISCOVERY_SOURCE_KIND,
  DiscoveryCampaignReference,
  DiscoveryScopeProgress,
  Lead,
  LeadSourceIdentity,
  PROVIDER_RUN_STATUS,
} from '../../src/domain/discovery/discovery-model.js';
import { LEAD_UPSERT_OUTCOME } from '../../src/ports/outbound/lead-repository.port.js';

const INTEGRATION_DATABASE_URI =
  'mongodb://localhost:27017/scout_discovery_step3_integration';
const CAMPAIGN_ID = 'integration-campaign';

describe('Mongo Discovery persistence', () => {
  let mongoDatabaseClient: MongoDatabaseClient;
  let leadRepository: MongoLeadRepository;
  let scopeRepository: MongoDiscoveryStateRepository;
  let quotaRepository: MongoProviderQuotaRepository;
  let previousMongoDbUri: string | undefined;

  beforeAll(async () => {
    previousMongoDbUri = process.env.DISCOVERY_MONGODB_URI;
    process.env.DISCOVERY_MONGODB_URI = INTEGRATION_DATABASE_URI;

    mongoDatabaseClient = new MongoDatabaseClient(
      new DiscoveryRuntimeConfiguration(),
    );
    await mongoDatabaseClient.onModuleInit();
    await mongoDatabaseClient.getDatabase().dropDatabase();

    leadRepository = new MongoLeadRepository(mongoDatabaseClient);
    scopeRepository = new MongoDiscoveryStateRepository(mongoDatabaseClient);
    quotaRepository = new MongoProviderQuotaRepository(mongoDatabaseClient);

    await Promise.all([
      leadRepository.onModuleInit(),
      scopeRepository.onModuleInit(),
      quotaRepository.onModuleInit(),
    ]);
  });

  afterAll(async () => {
    await mongoDatabaseClient.getDatabase().dropDatabase();
    await mongoDatabaseClient.onModuleDestroy();

    if (previousMongoDbUri === undefined) {
      delete process.env.DISCOVERY_MONGODB_URI;

      return;
    }

    process.env.DISCOVERY_MONGODB_URI = previousMongoDbUri;
  });

  it('enforces source identity uniqueness across repeated upserts', async () => {
    const sourceIdentity = new LeadSourceIdentity(
      'provider-place-1',
      DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
    );
    const createdAt = new Date('2026-09-01T00:00:00.000Z');
    const firstLead = new Lead(
      createdAt,
      {
        name: 'Initial name',
      },
      'lead-1',
      sourceIdentity,
      createdAt,
    );
    const repeatedLead = new Lead(
      createdAt,
      {
        name: 'Updated name',
      },
      'lead-2',
      sourceIdentity,
      new Date('2026-09-01T01:00:00.000Z'),
    );
    const firstResult = await leadRepository.upsertLead(firstLead);
    const repeatedResult = await leadRepository.upsertLead(repeatedLead);

    expect(firstResult.outcome).toBe(LEAD_UPSERT_OUTCOME.INSERTED);
    expect(repeatedResult.outcome).toBe(LEAD_UPSERT_OUTCOME.EXISTING);
    expect(
      await mongoDatabaseClient.getDatabase().collection('leads').countDocuments(),
    ).toBe(1);
  });

  it('atomically assigns one pending scope to concurrent workers', async () => {
    await scopeRepository.saveScopeProgress(
      createPendingScope('GB', 1),
    );

    const claims = await Promise.all(
      ['worker-a', 'worker-b', 'worker-c'].map((workerId) =>
        scopeRepository.claimNextEligibleScope({
          campaignId: CAMPAIGN_ID,
          claimedAt: new Date('2026-09-01T02:00:00.000Z'),
          workerId,
        }),
      ),
    );

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it('persists provider references and import progress across repository instances', async () => {
    const progress = new DiscoveryScopeProgress(
      2,
      new DiscoveryCampaignReference(CAMPAIGN_ID),
      1,
      new Date('2026-09-01T03:00:00.000Z'),
      'worker-a',
      undefined,
      undefined,
      {
        importedItemCount: 25,
        nextItemOffset: 25,
      },
      {
        datasetReference: 'dataset-1',
        providerRunId: 'run-1',
        status: PROVIDER_RUN_STATUS.SUCCEEDED,
      },
      'IE',
      DISCOVERY_SCOPE_STATUS.IMPORTING,
      new Date('2026-09-01T03:05:00.000Z'),
    );

    await scopeRepository.saveScopeProgress(progress);

    const restartedRepository = new MongoDiscoveryStateRepository(
      mongoDatabaseClient,
    );
    const restoredProgress = await restartedRepository.findScopeProgress(
      CAMPAIGN_ID,
      'IE',
    );

    expect(restoredProgress?.providerRun?.providerRunId).toBe('run-1');
    expect(restoredProgress?.importProgress?.nextItemOffset).toBe(25);
  });

  it('does not exceed the daily quota under concurrent reservations', async () => {
    const reservations = await Promise.all(
      Array.from({ length: 10 }, () =>
        quotaRepository.reserveDailyQuota({
          campaignId: `${CAMPAIGN_ID}-${randomUUID()}`,
          dailyItemLimit: 100,
          quotaDay: '2026-09-01',
          requestedItemCount: 25,
        }),
      ),
    );

    expect(reservations.filter((reservation) => reservation !== null)).toHaveLength(
      10,
    );

    const sameCampaignReservations = await Promise.all(
      Array.from({ length: 10 }, () =>
        quotaRepository.reserveDailyQuota({
          campaignId: 'shared-quota-campaign',
          dailyItemLimit: 100,
          quotaDay: '2026-09-01',
          requestedItemCount: 25,
        }),
      ),
    );

    expect(
      sameCampaignReservations.filter((reservation) => reservation !== null),
    ).toHaveLength(4);
  });
});

function createPendingScope(
  scopeId: string,
  priority: number,
): DiscoveryScopeProgress {
  return new DiscoveryScopeProgress(
    0,
    new DiscoveryCampaignReference(CAMPAIGN_ID),
    priority,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    scopeId,
    DISCOVERY_SCOPE_STATUS.PENDING,
    new Date('2026-09-01T00:00:00.000Z'),
  );
}
