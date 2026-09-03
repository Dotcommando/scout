import { Module } from '@nestjs/common';

import { GetBffReadinessService } from '../../../app/operations/get-bff-readiness.service.js';
import { DISCOVERY_MANAGEMENT_CLIENT } from '../../../ports/outbound/discovery-management-client.port.js';
import { QUALIFICATION_MANAGEMENT_CLIENT } from '../../../ports/outbound/qualification-management-client.port.js';
import { LocalDiscoveryManagementClient } from '../../outbound/http/local-discovery-management-client.js';
import { LocalQualificationManagementClient } from '../../outbound/http/local-qualification-management-client.js';
import { LocalServiceReadinessClient } from '../../outbound/http/local-service-readiness-client.js';
import { BffRuntimeConfiguration } from '../bootstrap/bff-runtime-configuration.js';
import { DiscoveryConfigurationController } from './discovery-configuration.controller.js';
import { DiscoveryLeadsController } from './discovery-leads.controller.js';
import { DiscoveryRunController } from './discovery-run.controller.js';
import { HealthController } from './health.controller.js';
import { QualificationConfigurationController } from './qualification-configuration.controller.js';
import { QualificationOperationsController } from './qualification-operations.controller.js';

@Module({
  controllers: [
    DiscoveryConfigurationController,
    DiscoveryLeadsController,
    DiscoveryRunController,
    HealthController,
    QualificationConfigurationController,
    QualificationOperationsController,
  ],
  providers: [
    BffRuntimeConfiguration,
    LocalServiceReadinessClient,
    LocalDiscoveryManagementClient,
    LocalQualificationManagementClient,
    {
      provide: DISCOVERY_MANAGEMENT_CLIENT,
      useExisting: LocalDiscoveryManagementClient,
    },
    {
      provide: QUALIFICATION_MANAGEMENT_CLIENT,
      useExisting: LocalQualificationManagementClient,
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
