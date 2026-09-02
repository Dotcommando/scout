import { LoggerService } from '@nestjs/common';

const ACTOR_GATEWAY_SERVICE_NAME = 'actor-gateway';
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

export interface IActorGatewayStructuredLogEntry {
  readonly actorDefinitionId?: string;
  readonly attempt?: number;
  readonly className: string;
  readonly correlationId: string;
  readonly durationMs?: number;
  readonly error?: ILoggedError;
  readonly input?: unknown;
  readonly level: string;
  readonly method: string;
  readonly operation: string;
  readonly providerRunId?: string;
  readonly requestId?: string;
  readonly retryable: boolean;
  readonly service: string;
}

interface ILoggedError {
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
}

export interface IActorGatewayFailureLogInput {
  readonly actorDefinitionId?: string;
  readonly attempt?: number;
  readonly className: string;
  readonly correlationId: string;
  readonly durationMs?: number;
  readonly error: unknown;
  readonly input?: unknown;
  readonly method: string;
  readonly operation: string;
  readonly providerRunId?: string;
  readonly requestId?: string;
  readonly retryable: boolean;
}

export class ActorGatewayStructuredLogger implements LoggerService {
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
    writeActorGatewayLog({
      className: 'NestLogger',
      correlationId: crypto.randomUUID(),
      input: [message, ...optionalParameters],
      level,
      method: 'write',
      operation: 'framework-log',
      retryable: false,
      service: ACTOR_GATEWAY_SERVICE_NAME,
    });
  }
}

export function writeActorGatewayFailureLog(
  input: IActorGatewayFailureLogInput,
): void {
  writeActorGatewayLog({
    ...(input.actorDefinitionId === undefined
      ? {}
      : { actorDefinitionId: input.actorDefinitionId }),
    ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
    className: input.className,
    correlationId: input.correlationId,
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    error: toLoggedError(input.error),
    input: input.input,
    level: 'error',
    method: input.method,
    operation: input.operation,
    ...(input.providerRunId === undefined
      ? {}
      : { providerRunId: input.providerRunId }),
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
    retryable: input.retryable,
    service: ACTOR_GATEWAY_SERVICE_NAME,
  });
}

export function writeActorGatewayLog(
  entry: IActorGatewayStructuredLogEntry,
): void {
  const output = `${JSON.stringify(sanitizeLogInput(entry))}\n`;

  if (entry.level === 'error' || entry.level === 'fatal') {
    process.stderr.write(output);

    return;
  }

  process.stdout.write(output);
}

function sanitizeLogInput(value: unknown): unknown {
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
