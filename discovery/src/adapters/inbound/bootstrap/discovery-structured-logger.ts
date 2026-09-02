import { LoggerService } from '@nestjs/common';

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_FIELD_NAMES = new Set([
  'apikey',
  'api_token',
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
]);

export interface IDiscoveryStructuredLogEntry {
  readonly attempt?: number;
  readonly brokerOperation?: string;
  readonly campaignId?: string;
  readonly className: string;
  readonly correlationId: string;
  readonly durationMs?: number;
  readonly error?: ILoggedError;
  readonly eventId?: string;
  readonly input?: unknown;
  readonly level: string;
  readonly message?: unknown;
  readonly method: string;
  readonly operation: string;
  readonly providerRunId?: string;
  readonly retryable: boolean;
  readonly service: string;
  readonly sourceKind?: string;
  readonly scopeId?: string;
}

interface ILoggedError {
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
}

interface IDiscoveryFailureLogInput {
  readonly attempt?: number;
  readonly brokerOperation?: string;
  readonly campaignId?: string;
  readonly className: string;
  readonly correlationId: string;
  readonly durationMs?: number;
  readonly error: unknown;
  readonly eventId?: string;
  readonly input?: unknown;
  readonly method: string;
  readonly operation: string;
  readonly providerRunId?: string;
  readonly retryable: boolean;
  readonly sourceKind?: string;
  readonly scopeId?: string;
}

export class DiscoveryStructuredLogger implements LoggerService {
  public debug(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('debug', message, optionalParameters);
  }

  public error(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('error', message, optionalParameters);
  }

  public fatal(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('fatal', message, optionalParameters);
  }

  public log(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('info', message, optionalParameters);
  }

  public verbose(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('verbose', message, optionalParameters);
  }

  public warn(message: unknown, ...optionalParameters: unknown[]): void {
    this.write('warn', message, optionalParameters);
  }

  private write(
    level: string,
    message: unknown,
    optionalParameters: unknown[],
  ): void {
    writeDiscoveryLog({
      className: 'NestLogger',
      correlationId: crypto.randomUUID(),
      ...(message instanceof Error
        ? { error: toLoggedError(message) }
        : { message }),
      input: optionalParameters,
      level,
      method: 'write',
      operation: 'framework-log',
      retryable: false,
      service: 'discovery',
    });
  }
}

export function writeDiscoveryFailureLog(
  input: IDiscoveryFailureLogInput,
): void {
  writeDiscoveryLog({
    ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
    ...(input.brokerOperation === undefined
      ? {}
      : { brokerOperation: input.brokerOperation }),
    ...(input.campaignId === undefined ? {} : { campaignId: input.campaignId }),
    className: input.className,
    correlationId: input.correlationId,
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    error: toLoggedError(input.error),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
    input: input.input,
    level: 'error',
    method: input.method,
    operation: input.operation,
    ...(input.providerRunId === undefined
      ? {}
      : { providerRunId: input.providerRunId }),
    retryable: input.retryable,
    service: 'discovery',
    ...(input.sourceKind === undefined ? {} : { sourceKind: input.sourceKind }),
    ...(input.scopeId === undefined ? {} : { scopeId: input.scopeId }),
  });
}

export function writeDiscoveryLog(entry: IDiscoveryStructuredLogEntry): void {
  const output = `${serializeDiscoveryLogEntry(entry)}\n`;

  if (entry.level === 'error' || entry.level === 'fatal') {
    process.stderr.write(output);

    return;
  }

  process.stdout.write(output);
}

export function serializeDiscoveryLogEntry(
  entry: IDiscoveryStructuredLogEntry,
): string {
  return JSON.stringify(sanitizeLogInput(entry));
}

export function sanitizeLogInput(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogInput(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        SENSITIVE_FIELD_NAMES.has(key.toLowerCase())
          ? REDACTED_VALUE
          : sanitizeLogInput(nestedValue),
      ]),
    );
  }

  return value;
}

function toLoggedError(error: unknown): ILoggedError {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }

  return {
    message: String(error),
    name: 'UnknownError',
  };
}
