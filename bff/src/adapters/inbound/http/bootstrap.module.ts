import { Module } from '@nestjs/common';

import { GetBffReadinessService } from '../../../app/operations/get-bff-readiness.service.js';
import { DISCOVERY_MANAGEMENT_CLIENT } from '../../../ports/outbound/discovery-management-client.port.js';
import { LocalDiscoveryManagementClient } from '../../outbound/http/local-discovery-management-client.js';
import { LocalServiceReadinessClient } from '../../outbound/http/local-service-readiness-client.js';
import { BffRuntimeConfiguration } from '../bootstrap/bff-runtime-configuration.js';
import { DiscoveryConfigurationController } from './discovery-configuration.controller.js';
import { DiscoveryRunController } from './discovery-run.controller.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [DiscoveryConfigurationController, DiscoveryRunController, HealthController],
  providers: [
    BffRuntimeConfiguration,
    LocalServiceReadinessClient,
    LocalDiscoveryManagementClient,
    {
      provide: DISCOVERY_MANAGEMENT_CLIENT,
      useExisting: LocalDiscoveryManagementClient,
    },
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
