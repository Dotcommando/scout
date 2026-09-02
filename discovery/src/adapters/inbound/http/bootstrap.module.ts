import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { DiscoveryProgressService } from '../../../app/discovery/discovery-progress.service.js';
import { ApifyGoogleMapsProviderAdapter } from '../../outbound/apify/apify-google-maps-provider-adapter.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoDiscoveryOutputRepository } from '../../outbound/mongodb/mongo-discovery-output-repository.js';
import { MongoDiscoveryStateRepository } from '../../outbound/mongodb/mongo-discovery-state-repository.js';
import { MongoLeadRepository } from '../../outbound/mongodb/mongo-lead-repository.js';
import { MongoProviderQuotaRepository } from '../../outbound/mongodb/mongo-provider-quota-repository.js';
import { RabbitMqConnectionVerifier } from '../../outbound/rabbitmq/rabbitmq-connection-verifier.js';
import { SystemClock } from '../../outbound/time/system-clock.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import { DiscoveryCampaignConfiguration } from '../configuration/discovery-campaign-configuration.js';
import { DiscoveryWorker } from '../scheduler/discovery-worker.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  imports: [ScheduleModule.forRoot()],
  providers: [
    DiscoveryCampaignConfiguration,
    DiscoveryRuntimeConfiguration,
    MongoDatabaseClient,
    MongoDiscoveryOutputRepository,
    MongoDiscoveryStateRepository,
    MongoLeadRepository,
    MongoProviderQuotaRepository,
    RabbitMqConnectionVerifier,
    SystemClock,
    {
      inject: [DiscoveryProgressService],
      provide: DiscoveryWorker,
      useFactory: (
        discoveryProgressService: DiscoveryProgressService,
      ): DiscoveryWorker => new DiscoveryWorker(discoveryProgressService),
    },
    {
      inject: [
        DiscoveryRuntimeConfiguration,
        DiscoveryCampaignConfiguration,
      ],
      provide: ApifyGoogleMapsProviderAdapter,
      useFactory: (
        runtimeConfiguration: DiscoveryRuntimeConfiguration,
        campaignConfiguration: DiscoveryCampaignConfiguration,
      ): ApifyGoogleMapsProviderAdapter =>
        new ApifyGoogleMapsProviderAdapter(
          runtimeConfiguration,
          campaignConfiguration,
        ),
    },
    {
      inject: [
        DiscoveryCampaignConfiguration,
        SystemClock,
        MongoDiscoveryOutputRepository,
        ApifyGoogleMapsProviderAdapter,
        MongoLeadRepository,
        MongoDiscoveryStateRepository,
        MongoProviderQuotaRepository,
      ],
      provide: DiscoveryProgressService,
      useFactory: (
        campaignConfiguration: DiscoveryCampaignConfiguration,
        clock: SystemClock,
        discoveryOutputRepository: MongoDiscoveryOutputRepository,
        discoveryProvider: ApifyGoogleMapsProviderAdapter,
        leadRepository: MongoLeadRepository,
        scopeRepository: MongoDiscoveryStateRepository,
        quotaRepository: MongoProviderQuotaRepository,
      ): DiscoveryProgressService =>
        new DiscoveryProgressService(
          campaignConfiguration,
          clock,
          discoveryOutputRepository,
          discoveryProvider,
          leadRepository,
          scopeRepository,
          quotaRepository,
        ),
    },
  ],
})
export class BootstrapModule {}
