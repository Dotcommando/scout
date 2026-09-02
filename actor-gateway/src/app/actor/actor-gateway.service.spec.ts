import {
  ACTOR_GATEWAY_SCHEMA_VERSION,
  ACTOR_REQUEST_STATUS,
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
} from '@scout/contracts';

import { IActorRequestRepositoryPort } from '../../ports/outbound/actor-request-repository.port.js';
import { ActorGatewayService } from './actor-gateway.service.js';

class FakeActorRequestRepository implements IActorRequestRepositoryPort {
  private readonly statuses = new Map<string, IActorGatewayRequestStatus>();

  public async findArchiveContent(): Promise<Uint8Array | null> {
    return null;
  }

  public async findArchiveManifest(): Promise<IActorGatewayArchiveManifest | null> {
    return null;
  }

  public async findRequestStatus(
    requestId: string,
  ): Promise<IActorGatewayRequestStatus | null> {
    return this.statuses.get(requestId) ?? null;
  }

  public async saveRequestStatus(
    status: IActorGatewayRequestStatus,
  ): Promise<void> {
    this.statuses.set(status.requestId, status);
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
});
