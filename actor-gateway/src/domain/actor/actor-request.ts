import { createHash } from 'node:crypto';

import {
  ACTOR_GATEWAY_SCHEMA_VERSION,
  ACTOR_REQUEST_STATUS,
  IActorGatewayRequestStatus,
  IActorGatewayResolveRequest,
} from '@scout/contracts';

export interface ICanonicalActorRequest {
  readonly canonicalInput: string;
  readonly createdAt: string;
  readonly input: IActorGatewayResolveRequest;
  readonly requestId: string;
  readonly reuseKey: string;
  readonly reusableUntil: string;
}

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

export function createCanonicalActorRequest(
  requestId: string,
  input: IActorGatewayResolveRequest,
  createdAt: string,
  reusableUntil: string,
): ICanonicalActorRequest {
  const canonicalInput = canonicalizeJson(input.canonicalInput);
  const reuseKey = createHash('sha256')
    .update(input.actorDefinitionId)
    .update('\u0000')
    .update(input.actorRevision)
    .update('\u0000')
    .update(canonicalInput)
    .update('\u0000')
    .update(input.cachePolicyRevision)
    .digest('hex');

  return {
    canonicalInput,
    createdAt,
    input,
    requestId,
    reusableUntil,
    reuseKey,
  };
}

export function canonicalizeJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonical actor input must contain finite numbers');
    }

    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
      .join(',')}}`;
  }

  throw new Error('canonical actor input must be JSON serializable');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
