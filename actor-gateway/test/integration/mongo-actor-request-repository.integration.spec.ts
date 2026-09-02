import { gunzipSync } from 'node:zlib';

import {
  ACTOR_GATEWAY_SCHEMA_VERSION,
} from '@scout/contracts';

import { ActorGatewayRuntimeConfiguration } from '../../src/adapters/inbound/bootstrap/actor-gateway-runtime-configuration.js';
import { MongoActorRequestRepository } from '../../src/adapters/outbound/mongodb/mongo-actor-request-repository.js';
import { MongoDatabaseClient } from '../../src/adapters/outbound/mongodb/mongo-database-client.js';
import { createCanonicalActorRequest } from '../../src/domain/actor/actor-request.js';

const INTEGRATION_DATABASE_URI =
  'mongodb://localhost:27017/scout_actor_gateway_step2_integration';

describe('Mongo Actor Gateway request persistence', () => {
  let mongoDatabaseClient: MongoDatabaseClient;
  let previousMongoDbUri: string | undefined;
  let repository: MongoActorRequestRepository;

  beforeAll(async () => {
    previousMongoDbUri = process.env.ACTOR_GATEWAY_MONGODB_URI;
    process.env.ACTOR_GATEWAY_MONGODB_URI = INTEGRATION_DATABASE_URI;

    mongoDatabaseClient = new MongoDatabaseClient(
      new ActorGatewayRuntimeConfiguration(),
    );
    await mongoDatabaseClient.onModuleInit();
    await mongoDatabaseClient.getDatabase().dropDatabase();
    repository = new MongoActorRequestRepository(mongoDatabaseClient);
    await repository.onModuleInit();
  });

  afterAll(async () => {
    await mongoDatabaseClient.getDatabase().dropDatabase();
    await mongoDatabaseClient.onModuleDestroy();

    if (previousMongoDbUri === undefined) {
      delete process.env.ACTOR_GATEWAY_MONGODB_URI;

      return;
    }

    process.env.ACTOR_GATEWAY_MONGODB_URI = previousMongoDbUri;
  });

  it('atomically reuses an exact canonical request across concurrent callers', async () => {
    const request = createRequest('request-a', { checkIn: '2026-10-01' });
    const results = await Promise.all([
      repository.findOrCreateRequest(request),
      repository.findOrCreateRequest(createRequest('request-b', {
        checkIn: '2026-10-01',
      })),
    ]);

    expect(results[0]?.requestId).toBe('request-a');
    expect(results[1]?.requestId).toBe('request-a');
    expect(
      await mongoDatabaseClient.getDatabase().collection('actor_requests').countDocuments(),
    ).toBe(1);
  });

  it('archives every raw row and makes observed unused fields searchable', async () => {
    const content = new TextEncoder().encode(JSON.stringify([
      { amenities: ['pool'], type: 'property', unusedRoomCount: 12 },
      { type: 'searchMetadata' },
    ]));
    const manifest = await repository.saveArchive({
      actorDefinitionId: 'hotels-market',
      actorRevision: 'revision-1',
      archiveId: 'archive-a',
      content,
      contentType: 'application/json',
      recordBoundaryIndex: [0, 1],
      requestId: 'request-a',
      runId: 'run-a',
      storedAt: '2026-09-02T00:00:00.000Z',
    });
    const persistedContent = await repository.findArchiveContent('archive-a');
    const fields = await repository.findObservedFields('hotels-market', 'room');

    expect(manifest.contentEncoding).toBe('gzip');
    expect(persistedContent).not.toBeNull();
    expect(new TextDecoder().decode(gunzipSync(persistedContent ?? new Uint8Array())))
      .toContain('unusedRoomCount');
    expect(fields[0]?.jsonPointer).toContain('unusedRoomCount');
  });
});

function createRequest(requestId: string, canonicalInput: unknown) {
  return createCanonicalActorRequest(
    requestId,
    {
      actorDefinitionId: 'hotels-market',
      actorRevision: 'revision-1',
      cachePolicyRevision: 'cache-1',
      canonicalInput,
      correlationId: 'correlation-1',
      requestedAt: '2026-09-02T00:00:00.000Z',
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
    },
    '2026-09-02T00:00:00.000Z',
    '2026-09-03T00:00:00.000Z',
  );
}
