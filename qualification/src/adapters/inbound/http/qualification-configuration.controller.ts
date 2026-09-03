import { Controller, Get, Query, UnprocessableEntityException } from '@nestjs/common';

import { MongoQualificationConfiguration } from '../configuration/mongo-qualification-configuration.js';

@Controller('v1/qualification/configurations')
export class QualificationConfigurationController {
  public constructor(
    private readonly configuration: MongoQualificationConfiguration,
  ) {}

  @Get()
  public async getConfigurations(
    @Query('offset') offsetValue = '0',
    @Query('limit') limitValue = '50',
  ): Promise<unknown> {
    const offset = Number(offsetValue);
    const limit = Number(limitValue);

    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new UnprocessableEntityException({ message: 'offset and limit are invalid' });
    }

    const page = await this.configuration.getConfigurations(offset, limit);

    return { ...page, limit, offset };
  }
}
