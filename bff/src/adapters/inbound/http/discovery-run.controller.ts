import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import type {
  IDiscoveryManagementClientPort,
} from '../../../ports/outbound/discovery-management-client.port.js';
import {
  DISCOVERY_MANAGEMENT_CLIENT,
  HTTP_REQUEST_METHOD,
} from '../../../ports/outbound/discovery-management-client.port.js';

@Controller('api/v1/discovery')
export class DiscoveryRunController {
  public constructor(
    @Inject(DISCOVERY_MANAGEMENT_CLIENT)
    private readonly discoveryManagementClient: IDiscoveryManagementClientPort,
  ) {}

  @Post('runs')
  public requestRun(@Body() body: unknown): Promise<unknown> {
    return this.forward(HTTP_REQUEST_METHOD.POST, '/runs', body);
  }

  @Get('runs')
  public getRuns(
    @Query('campaignId') campaignId: string | undefined,
    @Query('offset') offset = '0',
    @Query('limit') limit = '50',
  ): Promise<unknown> {
    const query = new URLSearchParams({
      ...(campaignId === undefined ? {} : { campaignId }),
      limit,
      offset,
    });

    return this.forward(HTTP_REQUEST_METHOD.GET, `/runs?${query.toString()}`);
  }

  @Get('runs/:runId')
  public getRun(@Param('runId') runId: string): Promise<unknown> {
    return this.forward(HTTP_REQUEST_METHOD.GET, `/runs/${encodeURIComponent(runId)}`);
  }

  @Get('status')
  public getStatus(@Query('campaignId') campaignId: string): Promise<unknown> {
    const query = new URLSearchParams({ campaignId });

    return this.forward(HTTP_REQUEST_METHOD.GET, `/status?${query.toString()}`);
  }

  private async forward(
    method: HTTP_REQUEST_METHOD,
    suffix: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await this.discoveryManagementClient.request(
      method,
      `/v1/discovery${suffix}`,
      crypto.randomUUID(),
      body,
    );

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.body;
    }

    throw new HttpException(JSON.stringify(response.body), response.statusCode);
  }
}
