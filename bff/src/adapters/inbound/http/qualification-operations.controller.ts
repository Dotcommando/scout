import { Body, Controller, Get, Headers, HttpCode, HttpException, Inject, Param, Post, Query } from '@nestjs/common';

import { HTTP_REQUEST_METHOD } from '../../../ports/outbound/discovery-management-client.port.js';
import type { IQualificationManagementClientPort } from '../../../ports/outbound/qualification-management-client.port.js';
import { QUALIFICATION_MANAGEMENT_CLIENT } from '../../../ports/outbound/qualification-management-client.port.js';

@Controller('api/v1/qualification')
export class QualificationOperationsController {
  public constructor(
    @Inject(QUALIFICATION_MANAGEMENT_CLIENT)
    private readonly qualificationManagementClient: IQualificationManagementClientPort,
  ) {}

  @Get('status')
  public async getStatus(@Query('campaignId') campaignId: string, @Query('profileVersion') profileVersion = '1', @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    return this.request(HTTP_REQUEST_METHOD.GET, `/v1/qualification/status?${new URLSearchParams({ campaignId, profileVersion }).toString()}`, correlationId);
  }

  @Post('executions')
  @HttpCode(202)
  public async requestExecution(@Body() body: unknown, @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    return this.request(HTTP_REQUEST_METHOD.POST, '/v1/qualification/executions', correlationId, body);
  }

  @Get('executions')
  public async listExecutions(@Query('campaignId') campaignId: string, @Query('offset') offset = '0', @Query('limit') limit = '50', @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    return this.request(HTTP_REQUEST_METHOD.GET, `/v1/qualification/executions?${new URLSearchParams({ campaignId, limit, offset }).toString()}`, correlationId);
  }

  @Get('executions/:executionId')
  public async getExecution(@Param('executionId') executionId: string, @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    return this.request(HTTP_REQUEST_METHOD.GET, `/v1/qualification/executions/${encodeURIComponent(executionId)}`, correlationId);
  }

  @Get('qualified-leads')
  public async getQualifiedLeads(@Query('campaignId') campaignId: string, @Query('profileVersion') profileVersion = '1', @Query('offset') offset = '0', @Query('limit') limit = '50', @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    return this.request(HTTP_REQUEST_METHOD.GET, `/v1/qualification/qualified-leads?${new URLSearchParams({ campaignId, limit, offset, profileVersion }).toString()}`, correlationId);
  }

  @Get('leads/:leadId')
  public async getLead(@Param('leadId') leadId: string, @Query('campaignId') campaignId: string, @Query('profileVersion') profileVersion = '1', @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    return this.request(HTTP_REQUEST_METHOD.GET, `/v1/qualification/leads/${encodeURIComponent(leadId)}?${new URLSearchParams({ campaignId, profileVersion }).toString()}`, correlationId);
  }

  private async request(method: HTTP_REQUEST_METHOD, path: string, correlationId: string | undefined, body?: unknown): Promise<unknown> {
    const response = await this.qualificationManagementClient.request(method, path, correlationId ?? crypto.randomUUID(), body);

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.body;
    }
    throw new HttpException(JSON.stringify(response.body), response.statusCode);
  }
}
