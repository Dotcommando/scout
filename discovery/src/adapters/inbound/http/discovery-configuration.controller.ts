import { Controller, Get, Inject, Query } from '@nestjs/common';

import type {
  IDiscoveryConfigurationPage,
  IGetDiscoveryConfigurationsUseCase,
} from '../../../ports/inbound/get-discovery-configurations.use-case.js';
import {
  GET_DISCOVERY_CONFIGURATIONS_USE_CASE,
} from '../../../ports/inbound/get-discovery-configurations.use-case.js';

@Controller('v1/discovery/configurations')
export class DiscoveryConfigurationController {
  public constructor(
    @Inject(GET_DISCOVERY_CONFIGURATIONS_USE_CASE)
    private readonly getDiscoveryConfigurationsUseCase: IGetDiscoveryConfigurationsUseCase,
  ) {}

  @Get()
  public async getConfigurations(
    @Query('offset') offsetValue = '0',
    @Query('limit') limitValue = '50',
  ): Promise<IDiscoveryConfigurationPage> {
    return this.getDiscoveryConfigurationsUseCase.getConfigurations(
      Number(offsetValue),
      Number(limitValue),
    );
  }
}
