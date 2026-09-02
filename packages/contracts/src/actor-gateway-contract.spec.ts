import {
  ACTOR_GATEWAY_SCHEMA_VERSION,
  ACTOR_REQUEST_STATUS,
  ActorGatewayContractValidationError,
  parseActorGatewayRequestStatus,
  parseActorGatewayResolveRequest,
} from './actor-gateway-contract.js';

describe('actor gateway contracts', () => {
  it('accepts a versioned generic request', () => {
    expect(
      parseActorGatewayResolveRequest({
        actorDefinitionId: 'google-maps',
        actorRevision: '1',
        cachePolicyRevision: '1',
        canonicalInput: { search: 'lodging' },
        correlationId: 'correlation-1',
        requestedAt: '2026-09-02T10:00:00.000Z',
        schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
      }),
    ).toMatchObject({ actorDefinitionId: 'google-maps' });
  });

  it('rejects an unknown request status', () => {
    expect(() => parseActorGatewayRequestStatus({
      actorDefinitionId: 'google-maps',
      actorRevision: '1',
      correlationId: 'correlation-1',
      createdAt: '2026-09-02T10:00:00.000Z',
      requestId: 'request-1',
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
      status: 'COMPLETE',
      updatedAt: '2026-09-02T10:00:00.000Z',
    })).toThrow(ActorGatewayContractValidationError);
  });

  it('accepts an explicit pending status', () => {
    const status = parseActorGatewayRequestStatus({
      actorDefinitionId: 'google-maps',
      actorRevision: '1',
      correlationId: 'correlation-1',
      createdAt: '2026-09-02T10:00:00.000Z',
      requestId: 'request-1',
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
      status: ACTOR_REQUEST_STATUS.PENDING,
      updatedAt: '2026-09-02T10:00:00.000Z',
    });

    expect(status.status).toBe(ACTOR_REQUEST_STATUS.PENDING);
  });
});
