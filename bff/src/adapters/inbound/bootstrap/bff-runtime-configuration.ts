import { resolve } from 'node:path';

import { Injectable } from '@nestjs/common';
import { config as loadEnvironmentFile } from 'dotenv';

const BFF_ENVIRONMENT_FILE_NAME = '.env';
const BFF_PORT_KEY = 'BFF_PORT';
const BFF_DISCOVERY_URL_KEY = 'BFF_DISCOVERY_URL';
const BFF_QUALIFICATION_URL_KEY = 'BFF_QUALIFICATION_URL';
const BFF_HTTP_TIMEOUT_MS_KEY = 'BFF_HTTP_TIMEOUT_MS';
const BFF_CORS_ORIGINS_KEY = 'BFF_CORS_ORIGINS';
const MINIMUM_HTTP_TIMEOUT_MS = 100;
const MAXIMUM_HTTP_TIMEOUT_MS = 30_000;

export interface IBffRuntimeConfiguration {
  readonly corsOrigins: readonly string[];
  readonly discoveryUrl: string;
  readonly httpTimeoutMs: number;
  readonly port: number;
  readonly qualificationUrl: string;
}

export class BffRuntimeConfigurationValidationError extends Error {
  public constructor(
    public readonly configurationFilePath: string,
    public readonly fieldPath: string,
    reason: string,
  ) {
    super(`Invalid runtime configuration in ${configurationFilePath}: ${fieldPath}: ${reason}`);
    this.name = 'BffRuntimeConfigurationValidationError';
  }
}

@Injectable()
export class BffRuntimeConfiguration implements IBffRuntimeConfiguration {
  public readonly corsOrigins: readonly string[];
  public readonly discoveryUrl: string;
  public readonly httpTimeoutMs: number;
  public readonly port: number;
  public readonly qualificationUrl: string;

  public constructor() {
    const configuration = loadBffRuntimeConfiguration();

    this.corsOrigins = configuration.corsOrigins;
    this.discoveryUrl = configuration.discoveryUrl;
    this.httpTimeoutMs = configuration.httpTimeoutMs;
    this.port = configuration.port;
    this.qualificationUrl = configuration.qualificationUrl;
  }
}

export function loadBffRuntimeConfiguration(): IBffRuntimeConfiguration {
  const configurationFilePath = resolve(process.cwd(), '..', BFF_ENVIRONMENT_FILE_NAME);

  loadEnvironmentFile({
    override: false,
    path: configurationFilePath,
    quiet: true,
  });

  return createBffRuntimeConfiguration(process.env, configurationFilePath);
}

export function createBffRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
  configurationFilePath: string,
): IBffRuntimeConfiguration {
  return {
    corsOrigins: parseCorsOrigins(
      environment[BFF_CORS_ORIGINS_KEY],
      configurationFilePath,
    ),
    discoveryUrl: parseHttpUrl(
      environment[BFF_DISCOVERY_URL_KEY],
      configurationFilePath,
      BFF_DISCOVERY_URL_KEY,
    ),
    httpTimeoutMs: parseBoundedInteger(
      environment[BFF_HTTP_TIMEOUT_MS_KEY],
      configurationFilePath,
      BFF_HTTP_TIMEOUT_MS_KEY,
      MINIMUM_HTTP_TIMEOUT_MS,
      MAXIMUM_HTTP_TIMEOUT_MS,
    ),
    port: parseBoundedInteger(
      environment[BFF_PORT_KEY],
      configurationFilePath,
      BFF_PORT_KEY,
      1,
      65_535,
    ),
    qualificationUrl: parseHttpUrl(
      environment[BFF_QUALIFICATION_URL_KEY],
      configurationFilePath,
      BFF_QUALIFICATION_URL_KEY,
    ),
  };
}

function parseCorsOrigins(
  value: string | undefined,
  configurationFilePath: string,
): readonly string[] {
  const origins = readRequiredValue(value, configurationFilePath, BFF_CORS_ORIGINS_KEY)
    .split(',')
    .map((origin) => origin.trim());

  if (origins.length === 0 || origins.some((origin) => origin.length === 0)) {
    throw new BffRuntimeConfigurationValidationError(
      configurationFilePath,
      BFF_CORS_ORIGINS_KEY,
      'must contain one or more comma-separated HTTP origins',
    );
  }

  return origins.map((origin) => parseHttpUrl(origin, configurationFilePath, BFF_CORS_ORIGINS_KEY));
}

function parseHttpUrl(
  value: string | undefined,
  configurationFilePath: string,
  fieldPath: string,
): string {
  const rawUrl = readRequiredValue(value, configurationFilePath, fieldPath);

  try {
    const url = new URL(rawUrl);

    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname.length === 0) {
      throw new BffRuntimeConfigurationValidationError(
        configurationFilePath,
        fieldPath,
        'must be an HTTP URL with a hostname',
      );
    }
  } catch (error: unknown) {
    if (error instanceof BffRuntimeConfigurationValidationError) {
      throw error;
    }

    throw new BffRuntimeConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'must be a valid HTTP URL',
    );
  }

  return rawUrl.replace(/\/$/, '');
}

function parseBoundedInteger(
  value: string | undefined,
  configurationFilePath: string,
  fieldPath: string,
  minimum: number,
  maximum: number,
): number {
  const parsedValue = Number(value);

  if (!Number.isSafeInteger(parsedValue) || parsedValue < minimum || parsedValue > maximum) {
    throw new BffRuntimeConfigurationValidationError(
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
    throw new BffRuntimeConfigurationValidationError(
      configurationFilePath,
      fieldPath,
      'is required',
    );
  }

  return value;
}
