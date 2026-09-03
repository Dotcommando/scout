export enum BFF_SERVICE_SCHEMA_VERSION {
  V1 = 1,
}

export enum BFF_SERVICE_HEALTH_STATUS {
  OK = 'ok',
  UNAVAILABLE = 'unavailable',
}

export interface IServiceHealthResponse {
  readonly service: string;
  readonly status: BFF_SERVICE_HEALTH_STATUS;
}

export class BffServiceContractValidationError extends Error {
  public constructor(
    public readonly fieldPath: string,
    reason: string,
  ) {
    super(`Invalid BFF service contract: ${fieldPath}: ${reason}`);
    this.name = 'BffServiceContractValidationError';
  }
}

export function parseServiceHealthResponse(
  input: unknown,
): IServiceHealthResponse {
  const response = readRecord(input, 'response');

  return {
    service: readNonEmptyString(response.service, 'service'),
    status: readHealthStatus(response.status),
  };
}

function readHealthStatus(value: unknown): BFF_SERVICE_HEALTH_STATUS {
  for (const status of Object.values(BFF_SERVICE_HEALTH_STATUS)) {
    if (value === status) {
      return status;
    }
  }

  throw new BffServiceContractValidationError(
    'status',
    `must be one of ${Object.values(BFF_SERVICE_HEALTH_STATUS).join(', ')}`,
  );
}

function readNonEmptyString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BffServiceContractValidationError(fieldPath, 'must be a non-empty string');
  }

  return value;
}

function readRecord(value: unknown, fieldPath: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BffServiceContractValidationError(fieldPath, 'must be an object');
  }

  const record: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    record[key] = nestedValue;
  }

  return record;
}
