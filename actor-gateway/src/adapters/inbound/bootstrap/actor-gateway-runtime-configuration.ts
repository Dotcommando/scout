import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { config as loadEnvironmentFile } from 'dotenv';

const ACTOR_GATEWAY_ENVIRONMENT_FILE_NAME = '.env';
const APIFY_API_TOKEN_KEY = 'APIFY_API_TOKEN';
const ACTOR_GATEWAY_MONGODB_URI_KEY = 'ACTOR_GATEWAY_MONGODB_URI';
const ACTOR_GATEWAY_PORT_KEY = 'ACTOR_GATEWAY_PORT';

export interface IActorGatewayRuntimeConfiguration {
  readonly apifyApiToken: string;
  readonly mongodbUri: string;
  readonly port: number;
}

export class ActorGatewayRuntimeConfigurationValidationError extends Error {
  public constructor(
    public readonly configurationFilePath: string,
    public readonly fieldPath: string,
    reason: string,
  ) {
    super(
      `Invalid actor gateway runtime configuration in ${configurationFilePath}: ${fieldPath}: ${reason}`,
    );
    this.name = 'ActorGatewayRuntimeConfigurationValidationError';
  }
}

@Injectable()
export class ActorGatewayRuntimeConfiguration
  implements IActorGatewayRuntimeConfiguration {
  public readonly apifyApiToken: string;
  public readonly mongodbUri: string;
  public readonly port: number;

  public constructor() {
    const configuration = loadActorGatewayRuntimeConfiguration();

    this.apifyApiToken = configuration.apifyApiToken;
    this.mongodbUri = configuration.mongodbUri;
    this.port = configuration.port;
  }
}

export function loadActorGatewayRuntimeConfiguration(): IActorGatewayRuntimeConfiguration {
  const configurationFilePath = resolve(
    process.cwd(),
    '..',
    ACTOR_GATEWAY_ENVIRONMENT_FILE_NAME,
  );

  loadEnvironmentFile({
    override: false,
    path: configurationFilePath,
    quiet: true,
  });

  return createActorGatewayRuntimeConfiguration(
    process.env,
    configurationFilePath,
  );
}

export function createActorGatewayRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
  configurationFilePath: string,
): IActorGatewayRuntimeConfiguration {
  return {
    apifyApiToken: readRequiredValue(
      environment[APIFY_API_TOKEN_KEY],
      configurationFilePath,
      APIFY_API_TOKEN_KEY,
    ),
    mongodbUri: parseMongoDbUri(
      environment[ACTOR_GATEWAY_MONGODB_URI_KEY],
      configurationFilePath,
      ACTOR_GATEWAY_MONGODB_URI_KEY,
    ),
    port: parsePort(
      environment[ACTOR_GATEWAY_PORT_KEY],
      configurationFilePath,
      ACTOR_GATEWAY_PORT_KEY,
    ),
  };
}

function readRequiredValue(
  value: string | undefined,
  configurationFilePath: string,
  fieldPath: string,
): string {
  if (value === undefined || value.trim().length === 0) {
    throw new ActorGatewayRuntimeConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'is required',
    );
  }

  return value;
}

function parsePort(
  value: string | undefined,
  configurationFilePath: string,
  fieldPath: string,
): number {
  const port = Number(value);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new ActorGatewayRuntimeConfigurationValidationError(
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
  if (value === undefined || value.trim().length === 0) {
    throw new ActorGatewayRuntimeConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'is required',
    );
  }
  if (!value.startsWith('mongodb://') && !value.startsWith('mongodb+srv://')) {
    throw new ActorGatewayRuntimeConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must use the mongodb:// or mongodb+srv:// scheme',
    );
  }

  return value;
}
