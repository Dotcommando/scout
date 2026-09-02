import {
  ACTOR_GATEWAY_SCHEMA_VERSION,
  ACTOR_REQUEST_STATUS,
  IActorGatewayRequestStatus,
  IActorGatewayResolveRequest,
} from '@scout/contracts';

export function createPendingActorRequest(
  requestId: string,
  input: IActorGatewayResolveRequest,
  createdAt: string,
): IActorGatewayRequestStatus {
  return {
    actorDefinitionId: input.actorDefinitionId,
    actorRevision: input.actorRevision,
    correlationId: input.correlationId,
    createdAt,
    requestId,
    schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
    status: ACTOR_REQUEST_STATUS.PENDING,
    updatedAt: createdAt,
  };
}
