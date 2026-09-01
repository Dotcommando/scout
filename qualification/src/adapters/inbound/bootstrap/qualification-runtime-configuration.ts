import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { config as loadEnvironmentFile } from 'dotenv';

const QUALIFICATION_ENVIRONMENT_FILE_NAME = '.env';
const QUALIFICATION_PORT_KEY = 'QUALIFICATION_PORT';
const QUALIFICATION_MONGODB_URI_KEY = 'QUALIFICATION_MONGODB_URI';

export interface IQualificationRuntimeConfiguration {
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
export class QualificationRuntimeConfiguration
  implements IQualificationRuntimeConfiguration {
  public readonly mongodbUri: string;
  public readonly port: number;

  public constructor() {
    const configuration = loadQualificationRuntimeConfiguration();

    this.mongodbUri = configuration.mongodbUri;
    this.port = configuration.port;
  }
}

export function loadQualificationRuntimeConfiguration(): IQualificationRuntimeConfiguration {
  const configurationFilePath = resolve(
    process.cwd(),
    '..',
    QUALIFICATION_ENVIRONMENT_FILE_NAME,
  );

  loadEnvironmentFile({
    override: false,
    path: configurationFilePath,
    quiet: true,
  });

  return createQualificationRuntimeConfiguration(
    process.env,
    configurationFilePath,
  );
}

export function createQualificationRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
  configurationFilePath: string,
): IQualificationRuntimeConfiguration {
  const port = parsePort(
    environment[QUALIFICATION_PORT_KEY],
    configurationFilePath,
    QUALIFICATION_PORT_KEY,
  );
  const mongodbUri = parseMongoDbUri(
    environment[QUALIFICATION_MONGODB_URI_KEY],
    configurationFilePath,
    QUALIFICATION_MONGODB_URI_KEY,
  );

  return {
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
