import { Module } from '@nestjs/common';

import { GetBffReadinessService } from '../../../app/operations/get-bff-readiness.service.js';
import { LocalServiceReadinessClient } from '../../outbound/http/local-service-readiness-client.js';
import { BffRuntimeConfiguration } from '../bootstrap/bff-runtime-configuration.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    BffRuntimeConfiguration,
    LocalServiceReadinessClient,
    {
      inject: [LocalServiceReadinessClient],
      provide: GetBffReadinessService,
      useFactory: (
        localServiceReadinessClient: LocalServiceReadinessClient,
      ): GetBffReadinessService => new GetBffReadinessService(
        localServiceReadinessClient,
      ),
    },
  ],
})
export class BootstrapModule {}
