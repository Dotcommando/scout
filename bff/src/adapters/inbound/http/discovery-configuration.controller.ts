import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import type {
  IDiscoveryManagementClientPort,
  IServiceHttpResponse,
} from '../../../ports/outbound/discovery-management-client.port.js';
import {
  DISCOVERY_MANAGEMENT_CLIENT,
  HTTP_REQUEST_METHOD,
} from '../../../ports/outbound/discovery-management-client.port.js';

@Controller('api/v1/discovery/configurations')
export class DiscoveryConfigurationController {
  public constructor(
    @Inject(DISCOVERY_MANAGEMENT_CLIENT)
    private readonly discoveryManagementClient: IDiscoveryManagementClientPort,
  ) {}

  @Post()
  public createConfiguration(@Body() body: unknown): Promise<unknown> {
    return this.forward(HTTP_REQUEST_METHOD.POST, '', body);
  }

  @Put(':campaignId')
  public replaceConfiguration(
    @Param('campaignId') campaignId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(HTTP_REQUEST_METHOD.PUT, `/${encodeURIComponent(campaignId)}`, body);
  }

  @Post(':campaignId/activate')
  public activateConfiguration(
    @Param('campaignId') campaignId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      HTTP_REQUEST_METHOD.POST,
      `/${encodeURIComponent(campaignId)}/activate`,
      body,
    );
  }

  @Delete()
  public archiveConfigurations(@Body() body: unknown): Promise<unknown> {
    return this.forward(HTTP_REQUEST_METHOD.DELETE, '', body);
  }

  @Get()
  public getConfigurations(
    @Query('offset') offset = '0',
    @Query('limit') limit = '50',
  ): Promise<unknown> {
    const query = new URLSearchParams({ limit, offset });

    return this.forward(HTTP_REQUEST_METHOD.GET, `?${query.toString()}`);
  }

  private async forward(
    method: HTTP_REQUEST_METHOD,
    suffix: string,
    body?: unknown,
  ): Promise<unknown> {
    const response = await this.discoveryManagementClient.request(
      method,
      `/v1/discovery/configurations${suffix}`,
      crypto.randomUUID(),
      body,
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
