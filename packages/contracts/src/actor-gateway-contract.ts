export const ACTOR_GATEWAY_API_PATH = '/v1/actor-requests';

export enum ACTOR_GATEWAY_SCHEMA_VERSION {
  V1 = 1,
}

export enum ACTOR_REQUEST_STATUS {
  PENDING = 'PENDING',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export interface IActorGatewayResolveRequest {
  readonly actorDefinitionId: string;
  readonly actorRevision: string;
  readonly cachePolicyRevision: string;
  readonly canonicalInput: unknown;
  readonly correlationId: string;
  readonly requestedAt: string;
  readonly schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION;
}

export interface IActorGatewayRequestStatus {
  readonly actorDefinitionId: string;
  readonly actorRevision: string;
  readonly archiveId?: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly requestId: string;
  readonly schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION;
  readonly status: ACTOR_REQUEST_STATUS;
  readonly updatedAt: string;
}

export interface IActorGatewayArchiveManifest {
  readonly archiveId: string;
  readonly byteLength: number;
  readonly contentEncoding: string;
  readonly contentType: string;
  readonly requestId: string;
  readonly runId: string;
  readonly schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION;
  readonly sha256: string;
  readonly storedAt: string;
}

export class ActorGatewayContractValidationError extends Error {
  public constructor(
    public readonly fieldPath: string,
    reason: string,
  ) {
    super(`Invalid actor-gateway contract: ${fieldPath}: ${reason}`);
    this.name = 'ActorGatewayContractValidationError';
  }
}

export function parseActorGatewayResolveRequest(
  input: unknown,
): IActorGatewayResolveRequest {
  const request = readRecord(input, 'request');

  return {
    actorDefinitionId: readNonEmptyString(
      request.actorDefinitionId,
      'actorDefinitionId',
    ),
    actorRevision: readNonEmptyString(request.actorRevision, 'actorRevision'),
    cachePolicyRevision: readNonEmptyString(
      request.cachePolicyRevision,
      'cachePolicyRevision',
    ),
    canonicalInput: readJsonValue(request.canonicalInput, 'canonicalInput'),
    correlationId: readNonEmptyString(request.correlationId, 'correlationId'),
    requestedAt: readIsoTimestamp(request.requestedAt, 'requestedAt'),
    schemaVersion: readSchemaVersion(request.schemaVersion),
  };
}

export function parseActorGatewayRequestStatus(
  input: unknown,
): IActorGatewayRequestStatus {
  const status = readRecord(input, 'status');

  return {
    actorDefinitionId: readNonEmptyString(
      status.actorDefinitionId,
      'actorDefinitionId',
    ),
    actorRevision: readNonEmptyString(status.actorRevision, 'actorRevision'),
    ...(status.archiveId === undefined
      ? {}
      : { archiveId: readNonEmptyString(status.archiveId, 'archiveId') }),
    correlationId: readNonEmptyString(status.correlationId, 'correlationId'),
    createdAt: readIsoTimestamp(status.createdAt, 'createdAt'),
    requestId: readNonEmptyString(status.requestId, 'requestId'),
    schemaVersion: readSchemaVersion(status.schemaVersion),
    status: readRequestStatus(status.status),
    updatedAt: readIsoTimestamp(status.updatedAt, 'updatedAt'),
  };
}

export function parseActorGatewayArchiveManifest(
  input: unknown,
): IActorGatewayArchiveManifest {
  const manifest = readRecord(input, 'manifest');

  return {
    archiveId: readNonEmptyString(manifest.archiveId, 'archiveId'),
    byteLength: readNonNegativeInteger(manifest.byteLength, 'byteLength'),
    contentEncoding: readNonEmptyString(
      manifest.contentEncoding,
      'contentEncoding',
    ),
    contentType: readNonEmptyString(manifest.contentType, 'contentType'),
    requestId: readNonEmptyString(manifest.requestId, 'requestId'),
    runId: readNonEmptyString(manifest.runId, 'runId'),
    schemaVersion: readSchemaVersion(manifest.schemaVersion),
    sha256: readNonEmptyString(manifest.sha256, 'sha256'),
    storedAt: readIsoTimestamp(manifest.storedAt, 'storedAt'),
  };
}

function readJsonValue(value: unknown, fieldPath: string): unknown {
  try {
    JSON.stringify(value);
  } catch {
    throw new ActorGatewayContractValidationError(
      fieldPath,
      'must be JSON serializable',
    );
  }

  if (value === undefined) {
    throw new ActorGatewayContractValidationError(fieldPath, 'is required');
  }

  return value;
}

function readNonNegativeInteger(value: unknown, fieldPath: string): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new ActorGatewayContractValidationError(
      fieldPath,
      'must be a non-negative integer',
    );
  }

  return value;
}

function readSchemaVersion(value: unknown): ACTOR_GATEWAY_SCHEMA_VERSION {
  if (value === ACTOR_GATEWAY_SCHEMA_VERSION.V1) {
    return ACTOR_GATEWAY_SCHEMA_VERSION.V1;
  }

  throw new ActorGatewayContractValidationError(
    'schemaVersion',
    `must equal ${ACTOR_GATEWAY_SCHEMA_VERSION.V1}`,
  );
}

function readRequestStatus(value: unknown): ACTOR_REQUEST_STATUS {
  for (const status of Object.values(ACTOR_REQUEST_STATUS)) {
    if (value === status) {
      return status;
    }
  }

  throw new ActorGatewayContractValidationError(
    'status',
    `must be one of ${Object.values(ACTOR_REQUEST_STATUS).join(', ')}`,
  );
}

function readIsoTimestamp(value: unknown, fieldPath: string): string {
  const timestamp = readNonEmptyString(value, fieldPath);

  if (Number.isNaN(Date.parse(timestamp))) {
    throw new ActorGatewayContractValidationError(
      fieldPath,
      'must be a valid ISO-8601 timestamp',
    );
  }

  return timestamp;
}

function readNonEmptyString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ActorGatewayContractValidationError(
      fieldPath,
      'must be a non-empty string',
    );
  }

  return value;
}

function readRecord(value: unknown, fieldPath: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ActorGatewayContractValidationError(fieldPath, 'must be an object');
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
