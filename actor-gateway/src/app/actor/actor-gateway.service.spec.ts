import {
  ACTOR_GATEWAY_SCHEMA_VERSION,
  ACTOR_REQUEST_STATUS,
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
} from '@scout/contracts';

import { ICanonicalActorRequest } from '../../domain/actor/actor-request.js';
import { ACTOR_PROVIDER_RUN_STATUS } from '../../ports/outbound/actor-provider.port.js';
import {
  ACTOR_EXECUTION_CLAIM_OUTCOME,
  IActorExecutionClaim,
  IActorRequestRepositoryPort,
  IObservedActorField,
} from '../../ports/outbound/actor-request-repository.port.js';
import { ActorExecutionService } from './actor-execution.service.js';
import { ActorGatewayService } from './actor-gateway.service.js';

class FakeActorRequestRepository implements IActorRequestRepositoryPort {
  private readonly statuses = new Map<string, IActorGatewayRequestStatus>();
  private readonly statusesByReuseKey = new Map<
    string,
    IActorGatewayRequestStatus
  >();

  public async findArchiveContent(): Promise<Uint8Array | null> {
    return null;
  }

  public async claimExecution(
    requestId: string,
  ): Promise<IActorExecutionClaim> {
    const status = this.statuses.get(requestId);

    if (status === undefined) {
      throw new Error('request was not found');
    }

    return {
      attempt: 1,
      outcome: ACTOR_EXECUTION_CLAIM_OUTCOME.CLAIMED,
      status,
    };
  }

  public async findArchiveManifest(): Promise<IActorGatewayArchiveManifest | null> {
    return null;
  }

  public async findObservedFields(): Promise<readonly IObservedActorField[]> {
    return [];
  }

  public async findRequestStatus(
    requestId: string,
  ): Promise<IActorGatewayRequestStatus | null> {
    return this.statuses.get(requestId) ?? null;
  }

  public async findOrCreateRequest(
    request: ICanonicalActorRequest,
  ): Promise<IActorGatewayRequestStatus> {
    const existing = this.statusesByReuseKey.get(request.reuseKey);

    if (existing !== undefined) {
      return existing;
    }

    const status: IActorGatewayRequestStatus = {
      actorDefinitionId: request.input.actorDefinitionId,
      actorRevision: request.input.actorRevision,
      correlationId: request.input.correlationId,
      createdAt: request.createdAt,
      requestId: request.requestId,
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
      status: ACTOR_REQUEST_STATUS.PENDING,
      updatedAt: request.createdAt,
    };

    this.statuses.set(status.requestId, status);
    this.statusesByReuseKey.set(request.reuseKey, status);

    return status;
  }

  public async saveArchive(): Promise<IActorGatewayArchiveManifest> {
    return {
      archiveId: 'archive-1',
      byteLength: 1,
      contentEncoding: 'gzip',
      contentType: 'application/json',
      requestId: 'request-1',
      runId: 'run-1',
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
      sha256: 'checksum',
      storedAt: '2026-09-02T00:00:00.000Z',
    };
  }

  public async markRequestSucceeded(
    requestId: string,
    archiveId: string,
    updatedAt: string,
  ): Promise<IActorGatewayRequestStatus> {
    const existing = this.statuses.get(requestId);

    if (existing === undefined) {
      throw new Error('request was not found');
    }

    const succeeded: IActorGatewayRequestStatus = {
      ...existing,
      archiveId,
      status: ACTOR_REQUEST_STATUS.SUCCEEDED,
      updatedAt,
    };

    this.statuses.set(requestId, succeeded);

    return succeeded;
  }

  public async markRequestFailed(
    requestId: string,
    updatedAt: string,
  ): Promise<IActorGatewayRequestStatus> {
    const existing = this.statuses.get(requestId);

    if (existing === undefined) {
      throw new Error('request was not found');
    }

    const failed = { ...existing, status: ACTOR_REQUEST_STATUS.FAILED, updatedAt };

    this.statuses.set(requestId, failed);

    return failed;
  }

  public async recordProviderRun(
    requestId: string,
  ): Promise<IActorGatewayRequestStatus> {
    const existing = this.statuses.get(requestId);

    if (existing === undefined) {
      throw new Error('request was not found');
    }

    return existing;
  }
}

describe('ActorGatewayService', () => {
  it('creates an explicit pending request status', async () => {
    const service = new ActorGatewayService(new FakeActorRequestRepository());
    const result = await service.resolveRequest({
      actorDefinitionId: 'maps-search',
      actorRevision: 'revision-1',
      cachePolicyRevision: 'cache-1',
      canonicalInput: { query: 'lodging' },
      correlationId: 'correlation-1',
      requestedAt: '2026-09-02T00:00:00.000Z',
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
    });

    expect(result.status).toBe(ACTOR_REQUEST_STATUS.PENDING);
    expect(result.actorDefinitionId).toBe('maps-search');
  });

  it('reuses an exact canonical request despite input key order', async () => {
    const repository = new FakeActorRequestRepository();
    const service = new ActorGatewayService(repository);
    const baseRequest = {
      actorDefinitionId: 'maps-search',
      actorRevision: 'revision-1',
      cachePolicyRevision: 'cache-1',
      correlationId: 'correlation-1',
      requestedAt: '2026-09-02T00:00:00.000Z',
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
    };
    const first = await service.resolveRequest({
      ...baseRequest,
      canonicalInput: { locale: 'en', query: 'lodging' },
    });
    const second = await service.resolveRequest({
      ...baseRequest,
      canonicalInput: { query: 'lodging', locale: 'en' },
    });

    expect(second.requestId).toBe(first.requestId);
  });

  it('does not reuse a request when the stay context changes', async () => {
    const service = new ActorGatewayService(new FakeActorRequestRepository());
    const baseRequest = {
      actorDefinitionId: 'hotels-market',
      actorRevision: 'revision-1',
      cachePolicyRevision: 'cache-1',
      correlationId: 'correlation-1',
      requestedAt: '2026-09-02T00:00:00.000Z',
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
    };
    const first = await service.resolveRequest({
      ...baseRequest,
      canonicalInput: { checkIn: '2026-10-01', guests: 2 },
    });
    const second = await service.resolveRequest({
      ...baseRequest,
      canonicalInput: { checkIn: '2026-10-02', guests: 2 },
    });

    expect(second.requestId).not.toBe(first.requestId);
  });

  it('archives a completed fixture provider run', async () => {
    const repository = new FakeActorRequestRepository();
    const executor = new ActorExecutionService({
      async getRun() { throw new Error('not used'); },
      async listDatasetRecords() { return [{ type: 'property' }]; },
      async startRun() {
        return {
          datasetId: 'dataset-1',
          providerRunId: 'run-1',
          status: ACTOR_PROVIDER_RUN_STATUS.SUCCEEDED,
        };
      },
    }, repository);
    const result = await new ActorGatewayService(repository, executor).resolveRequest({
      actorDefinitionId: 'google-maps-search',
actorRevision: 'latest',
      cachePolicyRevision: 'cache-1',
canonicalInput: { query: 'lodging' },
      correlationId: 'correlation-1',
requestedAt: '2026-09-02T00:00:00.000Z',
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
    });

    expect(result.status).toBe(ACTOR_REQUEST_STATUS.SUCCEEDED);
    expect(result.archiveId).toBeDefined();
  });
});
