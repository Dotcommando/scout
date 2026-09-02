import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { config as loadEnvironmentFile } from 'dotenv';

const DISCOVERY_ENVIRONMENT_FILE_NAME = '.env';
const DISCOVERY_LIVE_ARTIFACT_DIRECTORY_KEY = 'DISCOVERY_LIVE_ARTIFACT_DIRECTORY';
const DISCOVERY_PORT_KEY = 'DISCOVERY_PORT';
const DISCOVERY_MONGODB_URI_KEY = 'DISCOVERY_MONGODB_URI';
const DISCOVERY_RABBITMQ_CONNECTION_TIMEOUT_MS_KEY =
  'DISCOVERY_RABBITMQ_CONNECTION_TIMEOUT_MS';
const DISCOVERY_RABBITMQ_PREFETCH_KEY = 'DISCOVERY_RABBITMQ_PREFETCH';
const DISCOVERY_RABBITMQ_RETRY_DELAY_MS_KEY =
  'DISCOVERY_RABBITMQ_RETRY_DELAY_MS';
const DISCOVERY_RABBITMQ_RETRY_MAX_ATTEMPTS_KEY =
  'DISCOVERY_RABBITMQ_RETRY_MAX_ATTEMPTS';
const DISCOVERY_RABBITMQ_URI_KEY = 'DISCOVERY_RABBITMQ_URI';
const APIFY_API_TOKEN_KEY = 'APIFY_API_TOKEN';
const MINIMUM_RABBITMQ_CONNECTION_TIMEOUT_MS = 100;
const MAXIMUM_RABBITMQ_CONNECTION_TIMEOUT_MS = 30_000;
const MINIMUM_RABBITMQ_PREFETCH = 1;
const MAXIMUM_RABBITMQ_PREFETCH = 100;
const MINIMUM_RABBITMQ_RETRY_DELAY_MS = 1_000;
const MAXIMUM_RABBITMQ_RETRY_DELAY_MS = 3_600_000;
const MAXIMUM_RABBITMQ_RETRY_MAX_ATTEMPTS = 10;

export interface IDiscoveryRuntimeConfiguration {
  readonly apifyApiToken: string;
  readonly liveArtifactDirectory: string;
  readonly mongodbUri: string;
  readonly port: number;
  readonly rabbitmqConnectionTimeoutMs: number;
  readonly rabbitmqPrefetch: number;
  readonly rabbitmqRetryDelayMs: number;
  readonly rabbitmqRetryMaxAttempts: number;
  readonly rabbitmqUri: string;
}

export class RuntimeConfigurationValidationError extends Error {
  public constructor(
    public readonly configurationFilePath: string,
    public readonly fieldPath: string,
    reason: string,
  ) {
    super(
      `Invalid runtime configuration in ${configurationFilePath}: ${fieldPath}: ${reason}`,
    );
    this.name = 'RuntimeConfigurationValidationError';
  }
}

@Injectable()
export class DiscoveryRuntimeConfiguration
  implements IDiscoveryRuntimeConfiguration {
  public readonly apifyApiToken: string;
  public readonly liveArtifactDirectory: string;
  public readonly mongodbUri: string;
  public readonly port: number;
  public readonly rabbitmqConnectionTimeoutMs: number;
  public readonly rabbitmqPrefetch: number;
  public readonly rabbitmqRetryDelayMs: number;
  public readonly rabbitmqRetryMaxAttempts: number;
  public readonly rabbitmqUri: string;

  public constructor() {
    const configuration = loadDiscoveryRuntimeConfiguration();

    this.apifyApiToken = configuration.apifyApiToken;
    this.liveArtifactDirectory = configuration.liveArtifactDirectory;
    this.mongodbUri = configuration.mongodbUri;
    this.port = configuration.port;
    this.rabbitmqConnectionTimeoutMs = configuration.rabbitmqConnectionTimeoutMs;
    this.rabbitmqPrefetch = configuration.rabbitmqPrefetch;
    this.rabbitmqRetryDelayMs = configuration.rabbitmqRetryDelayMs;
    this.rabbitmqRetryMaxAttempts = configuration.rabbitmqRetryMaxAttempts;
    this.rabbitmqUri = configuration.rabbitmqUri;
  }
}

export function loadDiscoveryRuntimeConfiguration(): IDiscoveryRuntimeConfiguration {
  const configurationFilePath = resolve(
    process.cwd(),
    '..',
    DISCOVERY_ENVIRONMENT_FILE_NAME,
  );

  loadEnvironmentFile({
    override: false,
    path: configurationFilePath,
    quiet: true,
  });

  return createDiscoveryRuntimeConfiguration(
    process.env,
    configurationFilePath,
  );
}

export function createDiscoveryRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
  configurationFilePath: string,
): IDiscoveryRuntimeConfiguration {
  const port = parsePort(
    environment[DISCOVERY_PORT_KEY],
    configurationFilePath,
    DISCOVERY_PORT_KEY,
  );
  const mongodbUri = parseMongoDbUri(
    environment[DISCOVERY_MONGODB_URI_KEY],
    configurationFilePath,
    DISCOVERY_MONGODB_URI_KEY,
  );
  const apifyApiToken = readRequiredValue(
    environment[APIFY_API_TOKEN_KEY],
    configurationFilePath,
    APIFY_API_TOKEN_KEY,
  );
  const liveArtifactDirectory = readRequiredValue(
    environment[DISCOVERY_LIVE_ARTIFACT_DIRECTORY_KEY],
    configurationFilePath,
    DISCOVERY_LIVE_ARTIFACT_DIRECTORY_KEY,
  );
  const rabbitmqUri = parseRabbitMqUri(
    environment[DISCOVERY_RABBITMQ_URI_KEY],
    configurationFilePath,
    DISCOVERY_RABBITMQ_URI_KEY,
  );

  return {
    apifyApiToken,
    liveArtifactDirectory,
    mongodbUri,
    port,
    rabbitmqConnectionTimeoutMs: parseBoundedInteger(
      environment[DISCOVERY_RABBITMQ_CONNECTION_TIMEOUT_MS_KEY],
      configurationFilePath,
      DISCOVERY_RABBITMQ_CONNECTION_TIMEOUT_MS_KEY,
      MINIMUM_RABBITMQ_CONNECTION_TIMEOUT_MS,
      MAXIMUM_RABBITMQ_CONNECTION_TIMEOUT_MS,
    ),
    rabbitmqPrefetch: parseBoundedInteger(
      environment[DISCOVERY_RABBITMQ_PREFETCH_KEY],
      configurationFilePath,
      DISCOVERY_RABBITMQ_PREFETCH_KEY,
      MINIMUM_RABBITMQ_PREFETCH,
      MAXIMUM_RABBITMQ_PREFETCH,
    ),
    rabbitmqRetryDelayMs: parseBoundedInteger(
      environment[DISCOVERY_RABBITMQ_RETRY_DELAY_MS_KEY],
      configurationFilePath,
      DISCOVERY_RABBITMQ_RETRY_DELAY_MS_KEY,
      MINIMUM_RABBITMQ_RETRY_DELAY_MS,
      MAXIMUM_RABBITMQ_RETRY_DELAY_MS,
    ),
    rabbitmqRetryMaxAttempts: parseBoundedInteger(
      environment[DISCOVERY_RABBITMQ_RETRY_MAX_ATTEMPTS_KEY],
      configurationFilePath,
      DISCOVERY_RABBITMQ_RETRY_MAX_ATTEMPTS_KEY,
      0,
      MAXIMUM_RABBITMQ_RETRY_MAX_ATTEMPTS,
    ),
    rabbitmqUri,
  };
}

function parsePort(
  value: string | undefined,
  configurationFilePath: string,
  fieldPath: string,
): number {
  const port = Number(value);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new RuntimeConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be an integer between 1 and 65535',
    );
  }

  return port;
}

function parseMongoDbUri(
  value: string | undefined,
  configurationFilePath: string,
  fieldPath: string,
): string {
  const uri = readRequiredValue(value, configurationFilePath, fieldPath);

  if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new RuntimeConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must use the mongodb:// or mongodb+srv:// scheme',
    );
  }

  return uri;
}

function parseRabbitMqUri(
  value: string | undefined,
  configurationFilePath: string,
  fieldPath: string,
): string {
  const uri = readRequiredValue(value, configurationFilePath, fieldPath);

  try {
    const parsedUri = new URL(uri);

    if (parsedUri.protocol !== 'amqp:' && parsedUri.protocol !== 'amqps:') {
      throw new RuntimeConfigurationValidationError(
        configurationFilePath,
        fieldPath,
        'must use the amqp:// or amqps:// scheme',
      );
    }
    if (parsedUri.hostname.length === 0) {
      throw new RuntimeConfigurationValidationError(
        configurationFilePath,
        fieldPath,
        'must include a hostname',
      );
    }
  } catch (error: unknown) {
    if (error instanceof RuntimeConfigurationValidationError) {
      throw error;
    }

    throw new RuntimeConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be a valid AMQP URI',
    );
  }

  return uri;
}

function parseBoundedInteger(
  value: string | undefined,
  configurationFilePath: string,
  fieldPath: string,
  minimum: number,
  maximum: number,
): number {
  const parsedValue = Number(value);

  if (
    !Number.isSafeInteger(parsedValue)
    || parsedValue < minimum
    || parsedValue > maximum
  ) {
    throw new RuntimeConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      `must be an integer between ${minimum} and ${maximum}`,
    );
  }

  return parsedValue;
}

function readRequiredValue(
  value: string | undefined,
  configurationFilePath: string,
  fieldPath: string,
): string {
  if (value === undefined || value.trim().length === 0) {
    throw new RuntimeConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'is required',
    );
  }

  return value;
}
