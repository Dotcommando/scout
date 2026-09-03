import { Controller, Get, Headers, HttpException, Inject, Query } from '@nestjs/common';

import type {
  IDiscoveryManagementClientPort,
  IServiceHttpResponse,
} from '../../../ports/outbound/discovery-management-client.port.js';
import {
  DISCOVERY_MANAGEMENT_CLIENT,
  HTTP_REQUEST_METHOD,
} from '../../../ports/outbound/discovery-management-client.port.js';

@Controller('api/v1/discovery')
export class DiscoveryLeadsController {
  public constructor(
    @Inject(DISCOVERY_MANAGEMENT_CLIENT)
    private readonly discoveryManagementClient: IDiscoveryManagementClientPort,
  ) {}

  @Get('leads')
  public async getLeads(
    @Query('campaignId') campaignId: string,
    @Query('offset') offset = '0',
    @Query('limit') limit = '50',
    @Query('sortBy') sortBy = 'createdAt',
    @Query('sortDirection') sortDirection = 'desc',
    @Headers('x-correlation-id') correlationId?: string,
  ): Promise<unknown> {
    const query = new URLSearchParams({
      campaignId,
      limit,
      offset,
      sortBy,
      sortDirection,
    });
    const response = await this.discoveryManagementClient.request(
      HTTP_REQUEST_METHOD.GET,
      '/v1/discovery/leads?' + query.toString(),
      correlationId ?? crypto.randomUUID(),
    );

    return readSuccessfulResponse(response);
  }
}

function readSuccessfulResponse(response: IServiceHttpResponse): unknown {
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return response.body;
  }

  throw new HttpException(JSON.stringify(response.body), response.statusCode);
}
