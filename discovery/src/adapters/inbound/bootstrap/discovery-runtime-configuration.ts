import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { config as loadEnvironmentFile } from 'dotenv';

const DISCOVERY_ENVIRONMENT_FILE_NAME = '.env';
const DISCOVERY_PORT_KEY = 'DISCOVERY_PORT';
const DISCOVERY_MONGODB_URI_KEY = 'DISCOVERY_MONGODB_URI';
const APIFY_API_TOKEN_KEY = 'APIFY_API_TOKEN';

export interface IDiscoveryRuntimeConfiguration {
  readonly apifyApiToken: string;
  readonly mongodbUri: string;
  readonly port: number;
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
  public readonly mongodbUri: string;
  public readonly port: number;

  public constructor() {
    const configuration = loadDiscoveryRuntimeConfiguration();

    this.apifyApiToken = configuration.apifyApiToken;
    this.mongodbUri = configuration.mongodbUri;
    this.port = configuration.port;
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

  return {
    apifyApiToken,
    mongodbUri,
    port,
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
