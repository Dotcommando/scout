import { Injectable } from '@nestjs/common';
import {
  BFF_SERVICE_HEALTH_STATUS,
  parseServiceHealthResponse,
} from '@scout/contracts';

import {
  BFF_DEPENDENCY_KIND,
  IServiceReadinessClient,
} from '../../../ports/outbound/service-readiness-client.port.js';
import { BffRuntimeConfiguration } from '../../inbound/bootstrap/bff-runtime-configuration.js';

@Injectable()
export class LocalServiceReadinessClient implements IServiceReadinessClient {
  public constructor(
    private readonly runtimeConfiguration: BffRuntimeConfiguration,
  ) {}

  public async verifyReadiness(
    dependency: BFF_DEPENDENCY_KIND,
    correlationId: string,
  ): Promise<void> {
    const response = await fetch(`${this.resolveBaseUrl(dependency)}/health/ready`, {
      headers: { 'X-Correlation-Id': correlationId },
      signal: AbortSignal.timeout(this.runtimeConfiguration.httpTimeoutMs),
    });

    if (!response.ok) {
      throw new ServiceDependencyUnavailableError(dependency, response.status);
    }

    const health = parseServiceHealthResponse(await response.json());

    if (health.service !== dependency || health.status !== BFF_SERVICE_HEALTH_STATUS.OK) {
      throw new ServiceDependencyUnavailableError(dependency, response.status);
    }
  }

  private resolveBaseUrl(dependency: BFF_DEPENDENCY_KIND): string {
    return dependency === BFF_DEPENDENCY_KIND.DISCOVERY
      ? this.runtimeConfiguration.discoveryUrl
      : this.runtimeConfiguration.qualificationUrl;
  }
}

export class ServiceDependencyUnavailableError extends Error {
  public constructor(
    public readonly dependency: BFF_DEPENDENCY_KIND,
    public readonly statusCode: number,
  ) {
    super(`The ${dependency} service is unavailable`);
    this.name = 'ServiceDependencyUnavailableError';
  }
}
