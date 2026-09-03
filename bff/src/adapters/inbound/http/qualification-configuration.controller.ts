import { Controller, Get, HttpException, Inject, Query } from '@nestjs/common';

import { HTTP_REQUEST_METHOD } from '../../../ports/outbound/discovery-management-client.port.js';
import type { IQualificationManagementClientPort } from '../../../ports/outbound/qualification-management-client.port.js';
import { QUALIFICATION_MANAGEMENT_CLIENT } from '../../../ports/outbound/qualification-management-client.port.js';

@Controller('api/v1/qualification/configurations')
export class QualificationConfigurationController {
  public constructor(
    @Inject(QUALIFICATION_MANAGEMENT_CLIENT)
    private readonly qualificationManagementClient: IQualificationManagementClientPort,
  ) {}

  @Get()
  public async getConfigurations(
    @Query('offset') offset = '0',
    @Query('limit') limit = '50',
  ): Promise<unknown> {
    const query = new URLSearchParams({ limit, offset });
    const response = await this.qualificationManagementClient.request(
      HTTP_REQUEST_METHOD.GET,
      `/v1/qualification/configurations?${query.toString()}`,
      crypto.randomUUID(),
    );

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.body;
    }

    throw new HttpException(JSON.stringify(response.body), response.statusCode);
  }
}
