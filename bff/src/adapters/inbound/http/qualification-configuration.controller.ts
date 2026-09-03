import { Body, Controller, Delete, Get, Headers, HttpCode, HttpException, Inject, Param, Post, Put, Query } from '@nestjs/common';

import { HTTP_REQUEST_METHOD } from '../../../ports/outbound/discovery-management-client.port.js';
import type { IQualificationManagementClientPort } from '../../../ports/outbound/qualification-management-client.port.js';
import { QUALIFICATION_MANAGEMENT_CLIENT } from '../../../ports/outbound/qualification-management-client.port.js';

@Controller('api/v1/qualification')
export class QualificationConfigurationController {
  public constructor(
    @Inject(QUALIFICATION_MANAGEMENT_CLIENT)
    private readonly qualificationManagementClient: IQualificationManagementClientPort,
  ) {}

  @Get('configurations')
  public async getConfigurations(@Query('offset') offset = '0', @Query('limit') limit = '50', @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    const query = new URLSearchParams({ limit, offset });

    return this.request(HTTP_REQUEST_METHOD.GET, `/v1/qualification/configurations?${query.toString()}`, correlationId);
  }

  @Post('configurations')
  public async createConfiguration(@Body() body: unknown, @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    return this.request(HTTP_REQUEST_METHOD.POST, '/v1/qualification/configurations', correlationId, body);
  }

  @Put('configurations/:campaignId')
  public async replaceConfiguration(@Param('campaignId') campaignId: string, @Body() body: unknown, @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    return this.request(HTTP_REQUEST_METHOD.PUT, `/v1/qualification/configurations/${encodeURIComponent(campaignId)}`, correlationId, body);
  }

  @Post('configurations/:campaignId/activate')
  public async activateConfiguration(@Param('campaignId') campaignId: string, @Body() body: unknown, @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    return this.request(HTTP_REQUEST_METHOD.POST, `/v1/qualification/configurations/${encodeURIComponent(campaignId)}/activate`, correlationId, body);
  }

  @Delete('configurations')
  @HttpCode(200)
  public async archiveConfigurations(@Body() body: unknown, @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    return this.request(HTTP_REQUEST_METHOD.DELETE, '/v1/qualification/configurations', correlationId, body);
  }

  private async request(method: HTTP_REQUEST_METHOD, path: string, correlationId: string | undefined, body?: unknown): Promise<unknown> {
    const response = await this.qualificationManagementClient.request(method, path, correlationId ?? crypto.randomUUID(), body);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.body;
    }
    throw new HttpException(JSON.stringify(response.body), response.statusCode);
  }
}
