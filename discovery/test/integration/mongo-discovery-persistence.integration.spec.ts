import { randomUUID } from 'node:crypto';

import { DiscoveryRuntimeConfiguration } from '../../src/adapters/inbound/bootstrap/discovery-runtime-configuration.js';
import { MongoDatabaseClient } from '../../src/adapters/outbound/mongodb/mongo-database-client.js';
import { MongoDiscoveryBackfillRunRepository } from '../../src/adapters/outbound/mongodb/mongo-discovery-backfill-run-repository.js';
import { MongoDiscoveryOutputRepository } from '../../src/adapters/outbound/mongodb/mongo-discovery-output-repository.js';
import { MongoDiscoveryStateRepository } from '../../src/adapters/outbound/mongodb/mongo-discovery-state-repository.js';
import { MongoLeadRepository } from '../../src/adapters/outbound/mongodb/mongo-lead-repository.js';
import { MongoProviderQuotaRepository } from '../../src/adapters/outbound/mongodb/mongo-provider-quota-repository.js';
import {
  DISCOVERY_OUTPUT_ORIGIN,
  IDiscoveryOutputPayload,
} from '../../src/app/discovery/discovery-output-payload.js';
import {
  DISCOVERY_BACKFILL_RUN_STATUS,
  DISCOVERY_OUTPUT_STATUS,
  DISCOVERY_SCOPE_STATUS,
  DISCOVERY_SOURCE_KIND,
  DiscoveryCampaignReference,
  DiscoveryScopeProgress,
  Lead,
  LeadSourceIdentity,
  PROVIDER_RUN_STATUS,
} from '../../src/domain/discovery/discovery-model.js';
import { DISCOVERY_OUTPUT_SAVE_OUTCOME } from '../../src/ports/outbound/discovery-output-repository.port.js';
import { LEAD_UPSERT_OUTCOME } from '../../src/ports/outbound/lead-repository.port.js';

const INTEGRATION_DATABASE_URI =
  'mongodb://localhost:27017/scout_discovery_step3_integration';
const CAMPAIGN_ID = 'integration-campaign';

interface IIntegrationDiscoveryOutputDocument {
  readonly campaignId: string;
  readonly createdAt: Date;
  readonly leadId: string;
  readonly outputId: string;
  readonly payload: IDiscoveryOutputPayload;
  readonly status: DISCOVERY_OUTPUT_STATUS;
}

describe('Mongo Discovery persistence', () => {
  let mongoDatabaseClient: MongoDatabaseClient;
  let backfillRunRepository: MongoDiscoveryBackfillRunRepository;
  let outputRepository: MongoDiscoveryOutputRepository;
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
    backfillRunRepository = new MongoDiscoveryBackfillRunRepository(mongoDatabaseClient);
    outputRepository = new MongoDiscoveryOutputRepository(mongoDatabaseClient);
    scopeRepository = new MongoDiscoveryStateRepository(mongoDatabaseClient);
    quotaRepository = new MongoProviderQuotaRepository(mongoDatabaseClient);

    await Promise.all([
      leadRepository.onModuleInit(),
      backfillRunRepository.onModuleInit(),
      outputRepository.onModuleInit(),
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

  it('selects canonical leads in deterministic lead identity order', async () => {
    const createdAt = new Date('2026-09-01T01:30:00.000Z');

    await leadRepository.upsertLead(new Lead(
      createdAt,
      { name: 'Later lead' },
      'zz-backfill-lead',
      new LeadSourceIdentity('provider-place-z', DISCOVERY_SOURCE_KIND.GOOGLE_MAPS),
      createdAt,
    ));
    await leadRepository.upsertLead(new Lead(
      createdAt,
      { name: 'First backfill lead' },
      'aa-backfill-lead',
      new LeadSourceIdentity('provider-place-a', DISCOVERY_SOURCE_KIND.GOOGLE_MAPS),
      createdAt,
    ));

    const firstPage = await leadRepository.findLeadsForBackfill({
      limit: 2,
      sourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
    });
    const lastLead = firstPage.leads[1];

    if (lastLead === undefined) {
      throw new Error('expected a full first backfill page');
    }

    const secondPage = await leadRepository.findLeadsForBackfill({
      afterLeadId: lastLead.leadId,
      limit: 10,
      sourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
    });

    expect(firstPage.leads.map((lead) => lead.leadId)).toEqual([
      'aa-backfill-lead',
      'lead-1',
    ]);
    expect(secondPage.leads.map((lead) => lead.leadId)).toEqual([
      'zz-backfill-lead',
    ]);
    expect((await leadRepository.findLeadsForBackfill({
      leadIdPrefix: 'zz-backfill',
      limit: 10,
      sourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
    })).leads.map((lead) => lead.leadId)).toEqual(['zz-backfill-lead']);
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
      25,
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
    expect(restoredProgress?.reservedProviderItemCount).toBe(25);
  });

  it('atomically claims one recoverable active scope', async () => {
    const activeCampaignId = `${CAMPAIGN_ID}-active`;

    await scopeRepository.saveScopeProgress(
      new DiscoveryScopeProgress(
        1,
        new DiscoveryCampaignReference(activeCampaignId),
        1,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        25,
        {
          datasetReference: 'dataset-active',
          providerRunId: 'run-active',
          status: PROVIDER_RUN_STATUS.RUNNING,
        },
        'FR',
        DISCOVERY_SCOPE_STATUS.RUNNING,
        new Date('2026-09-01T04:00:00.000Z'),
      ),
    );

    const claims = await Promise.all(
      ['worker-a', 'worker-b'].map((workerId) =>
        scopeRepository.claimNextActiveScope({
          campaignId: activeCampaignId,
          claimedAt: new Date('2026-09-01T04:01:00.000Z'),
          staleClaimBefore: new Date('2026-09-01T03:56:00.000Z'),
          workerId,
        }),
      ),
    );

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it('creates one durable output for a campaign lead identity', async () => {
    const output = {
      campaignId: CAMPAIGN_ID,
      createdAt: new Date('2026-09-01T05:00:00.000Z'),
      leadId: 'lead-1',
      outputId: 'output-1',
      payload: {
        campaignId: CAMPAIGN_ID,
        correlationId: 'correlation-1',
        eventId: 'output-1',
        lead: {
          externalId: 'provider-place-1',
          leadId: 'lead-1',
          name: 'Example lead',
          sourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
        },
        occurredAt: new Date('2026-09-01T05:00:00.000Z'),
        origin: DISCOVERY_OUTPUT_ORIGIN.DISCOVERY,
        schemaVersion: 1,
      },
      status: DISCOVERY_OUTPUT_STATUS.PENDING,
    };
    const changedOutput = {
      ...output,
      payload: {
        ...output.payload,
        correlationId: 'correlation-2',
        lead: {
          ...output.payload.lead,
          name: 'Changed lead',
        },
      },
    };
    const firstSaveOutcome = await outputRepository.saveDiscoveryOutput(output);
    const repeatedSaveOutcome = await outputRepository.saveDiscoveryOutput(changedOutput);
    const collection = mongoDatabaseClient
      .getDatabase()
      .collection<IIntegrationDiscoveryOutputDocument>('discovery_outputs');
    const persistedOutput = await collection.findOne({
      campaignId: CAMPAIGN_ID,
      leadId: 'lead-1',
    });

    expect(await collection.countDocuments()).toBe(1);
    expect(firstSaveOutcome).toBe(DISCOVERY_OUTPUT_SAVE_OUTCOME.INSERTED);
    expect(repeatedSaveOutcome).toBe(DISCOVERY_OUTPUT_SAVE_OUTCOME.EXISTING);
    expect(persistedOutput?.payload).toEqual(output.payload);
  });

  it('persists an interrupted backfill run so its explicit run identity can resume', async () => {
    const startedAt = new Date('2026-09-01T05:30:00.000Z');

    await backfillRunRepository.startBackfillRun({
      campaignId: CAMPAIGN_ID,
      configurationHash: 'configuration-hash',
      correlationId: 'correlation-backfill-1',
      createdAt: startedAt,
      dryRun: false,
      maximumLeadCount: 10,
      qualificationCatalogRevision: '2026-09-02-r1',
      runId: 'backfill-run-1',
      selectedSourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
    });
    await backfillRunRepository.failBackfillRun({
      failedAt: new Date('2026-09-01T05:31:00.000Z'),
      failureMessage: 'simulated interruption',
      runId: 'backfill-run-1',
    });

    const restartedRepository = new MongoDiscoveryBackfillRunRepository(
      mongoDatabaseClient,
    );
    const resumedRun = await restartedRepository.startBackfillRun({
      campaignId: CAMPAIGN_ID,
      configurationHash: 'configuration-hash',
      correlationId: 'correlation-backfill-1',
      createdAt: new Date('2026-09-01T05:32:00.000Z'),
      dryRun: false,
      maximumLeadCount: 10,
      qualificationCatalogRevision: '2026-09-02-r1',
      runId: 'backfill-run-1',
      selectedSourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
    });

    expect(resumedRun.status).toBe(DISCOVERY_BACKFILL_RUN_STATUS.RUNNING);
    expect(resumedRun.failureMessage).toBeUndefined();
  });

  it('atomically claims one output and reclaims it after an expired lease', async () => {
    const output = {
      campaignId: `${CAMPAIGN_ID}-publication`,
      createdAt: new Date('2026-09-01T06:00:00.000Z'),
      leadId: 'publication-lead-1',
      outputId: 'publication-output-1',
      payload: {
        campaignId: `${CAMPAIGN_ID}-publication`,
        correlationId: 'publication-correlation-1',
        eventId: 'publication-output-1',
        lead: {
          externalId: 'publication-external-1',
          leadId: 'publication-lead-1',
          name: 'Publication lead',
          sourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
        },
        occurredAt: new Date('2026-09-01T06:00:00.000Z'),
        origin: DISCOVERY_OUTPUT_ORIGIN.DISCOVERY,
        schemaVersion: 1,
      },
      status: DISCOVERY_OUTPUT_STATUS.PENDING,
    };
    const existingOutputs = await outputRepository.claimPendingDiscoveryOutputs({
      claimedAt: new Date('2026-09-01T05:30:00.000Z'),
      leaseExpiresAt: new Date('2026-09-01T05:31:00.000Z'),
      limit: 10,
      retryEligibleAt: new Date('2026-09-01T05:30:00.000Z'),
      workerId: 'publisher-cleanup',
    });

    await Promise.all(
      existingOutputs.map((existingOutput) =>
        outputRepository.confirmDiscoveryOutputPublication({
          confirmedAt: new Date('2026-09-01T05:30:00.000Z'),
          outputId: existingOutput.outputId,
          workerId: 'publisher-cleanup',
        }),
      ),
    );
    await outputRepository.saveDiscoveryOutput(output);

    const concurrentClaims = await Promise.all(
      ['publisher-a', 'publisher-b'].map((workerId) =>
        outputRepository.claimPendingDiscoveryOutputs({
          claimedAt: new Date('2026-09-01T06:01:00.000Z'),
          leaseExpiresAt: new Date('2026-09-01T06:02:00.000Z'),
          limit: 1,
          retryEligibleAt: new Date('2026-09-01T06:01:00.000Z'),
          workerId,
        }),
      ),
    );

    expect(concurrentClaims.flat()).toHaveLength(1);

    const reclaimedOutputs = await outputRepository.claimPendingDiscoveryOutputs({
      claimedAt: new Date('2026-09-01T06:03:00.000Z'),
      leaseExpiresAt: new Date('2026-09-01T06:04:00.000Z'),
      limit: 1,
      retryEligibleAt: new Date('2026-09-01T06:03:00.000Z'),
      workerId: 'publisher-recovery',
    });

    expect(reclaimedOutputs).toEqual([
      expect.objectContaining({
        outputId: 'publication-output-1',
        publishAttemptCount: 2,
      }),
    ]);
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
    undefined,
    scopeId,
    DISCOVERY_SCOPE_STATUS.PENDING,
    new Date('2026-09-01T00:00:00.000Z'),
  );
}
