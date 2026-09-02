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

export interface IQualificationStructuredLogEntry {
  readonly attempt?: number;
  readonly brokerMessageId?: string;
  readonly brokerOperation?: string;
  readonly campaignId?: string;
  readonly className: string;
  readonly correlationId: string;
  readonly decision?: string;
  readonly durationMs?: number;
  readonly error?: ILoggedError;
  readonly eventId?: string;
  readonly failureKind?: string;
  readonly input?: unknown;
  readonly leadId?: string;
  readonly level: string;
  readonly message?: unknown;
  readonly method: string;
  readonly operation: string;
  readonly profileVersion?: number;
  readonly retryable: boolean;
  readonly service: string;
}

interface ILoggedError {
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
}

interface IQualificationFailureLogInput {
  readonly attempt?: number;
  readonly brokerMessageId?: string;
  readonly brokerOperation?: string;
  readonly campaignId?: string;
  readonly className: string;
  readonly correlationId: string;
  readonly durationMs?: number;
  readonly error: unknown;
  readonly eventId?: string;
  readonly failureKind?: string;
  readonly input?: unknown;
  readonly leadId?: string;
  readonly method: string;
  readonly operation: string;
  readonly profileVersion?: number;
  readonly retryable: boolean;
}

export class QualificationStructuredLogger implements LoggerService {
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
    writeQualificationLog({
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
      service: 'qualification',
    });
  }
}

export function writeQualificationFailureLog(
  input: IQualificationFailureLogInput,
): void {
  writeQualificationLog({
    ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
    ...(input.brokerMessageId === undefined
      ? {}
      : { brokerMessageId: input.brokerMessageId }),
    ...(input.brokerOperation === undefined
      ? {}
      : { brokerOperation: input.brokerOperation }),
    ...(input.campaignId === undefined ? {} : { campaignId: input.campaignId }),
    className: input.className,
    correlationId: input.correlationId,
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    error: toLoggedError(input.error),
    ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
    ...(input.failureKind === undefined
      ? {}
      : { failureKind: input.failureKind }),
    input: input.input,
    ...(input.leadId === undefined ? {} : { leadId: input.leadId }),
    level: 'error',
    method: input.method,
    operation: input.operation,
    ...(input.profileVersion === undefined
      ? {}
      : { profileVersion: input.profileVersion }),
    retryable: input.retryable,
    service: 'qualification',
  });
}

export function writeQualificationLog(
  entry: IQualificationStructuredLogEntry,
): void {
  const output = `${JSON.stringify(sanitizeLogInput(entry))}\n`;

  if (entry.level === 'error' || entry.level === 'fatal') {
    process.stderr.write(output);

    return;
  }

  process.stdout.write(output);
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
