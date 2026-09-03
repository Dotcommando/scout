import { LoggerService } from '@nestjs/common';

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_FIELD_NAMES = new Set([
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
]);

export interface IBffLogEntry {
  readonly className: string;
  readonly correlationId: string;
  readonly error?: ILoggedError;
  readonly input?: unknown;
  readonly level: string;
  readonly message?: unknown;
  readonly method: string;
  readonly operation: string;
  readonly retryable: boolean;
  readonly service: string;
}

interface ILoggedError {
  readonly message: string;
  readonly name: string;
  readonly stack?: string;
}

export class BffStructuredLogger implements LoggerService {
  public debug(message: unknown, ...parameters: unknown[]): void {
    this.write('debug', message, parameters);
  }

  public error(message: unknown, ...parameters: unknown[]): void {
    this.write('error', message, parameters);
  }

  public fatal(message: unknown, ...parameters: unknown[]): void {
    this.write('fatal', message, parameters);
  }

  public log(message: unknown, ...parameters: unknown[]): void {
    this.write('info', message, parameters);
  }

  public verbose(message: unknown, ...parameters: unknown[]): void {
    this.write('verbose', message, parameters);
  }

  public warn(message: unknown, ...parameters: unknown[]): void {
    this.write('warn', message, parameters);
  }

  private write(level: string, message: unknown, parameters: unknown[]): void {
    writeBffLog({
      className: 'NestLogger',
      correlationId: crypto.randomUUID(),
      ...(message instanceof Error
        ? { error: toLoggedError(message) }
        : { message }),
      input: parameters,
      level,
      method: 'write',
      operation: 'framework-log',
      retryable: false,
      service: 'bff',
    });
  }
}

export function writeBffFailureLog(
  className: string,
  correlationId: string,
  error: unknown,
  method: string,
  operation: string,
): void {
  writeBffLog({
    className,
    correlationId,
    error: toLoggedError(error),
    level: 'error',
    method,
    operation,
    retryable: true,
    service: 'bff',
  });
}

export function writeBffLog(entry: IBffLogEntry): void {
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
