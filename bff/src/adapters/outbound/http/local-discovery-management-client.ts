import { Injectable } from '@nestjs/common';

import {
  HTTP_REQUEST_METHOD,
  IDiscoveryManagementClientPort,
  IServiceHttpResponse,
} from '../../../ports/outbound/discovery-management-client.port.js';
import { BffRuntimeConfiguration } from '../../inbound/bootstrap/bff-runtime-configuration.js';

@Injectable()
export class LocalDiscoveryManagementClient implements IDiscoveryManagementClientPort {
  public constructor(
    private readonly runtimeConfiguration: BffRuntimeConfiguration,
  ) {}

  public async request(
    method: HTTP_REQUEST_METHOD,
    path: string,
    correlationId: string,
    body?: unknown,
  ): Promise<IServiceHttpResponse> {
    const response = await fetch(`${this.runtimeConfiguration.discoveryUrl}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'X-Correlation-Id': correlationId,
      },
      method,
      signal: AbortSignal.timeout(this.runtimeConfiguration.httpTimeoutMs),
    });

    return {
      body: await readResponseBody(response),
      statusCode: response.status,
    };
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');

  return contentType?.includes('application/json') === true
    ? response.json()
    : { message: await response.text() };
}
