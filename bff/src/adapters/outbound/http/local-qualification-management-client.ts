import { Injectable } from '@nestjs/common';

import { HTTP_REQUEST_METHOD, IServiceHttpResponse } from '../../../ports/outbound/discovery-management-client.port.js';
import { IQualificationManagementClientPort } from '../../../ports/outbound/qualification-management-client.port.js';
import { BffRuntimeConfiguration } from '../../inbound/bootstrap/bff-runtime-configuration.js';

@Injectable()
export class LocalQualificationManagementClient implements IQualificationManagementClientPort {
  public constructor(private readonly runtimeConfiguration: BffRuntimeConfiguration) {}

  public async request(
    method: HTTP_REQUEST_METHOD,
    path: string,
    correlationId: string,
    body?: unknown,
  ): Promise<IServiceHttpResponse> {
    const response = await fetch(`${this.runtimeConfiguration.qualificationUrl}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'X-Correlation-Id': correlationId,
      },
      method,
      signal: AbortSignal.timeout(this.runtimeConfiguration.httpTimeoutMs),
    });
    const contentType = response.headers.get('content-type');

    return {
      body: contentType?.includes('application/json') === true
        ? await response.json()
        : { message: await response.text() },
      statusCode: response.status,
    };
  }
}
