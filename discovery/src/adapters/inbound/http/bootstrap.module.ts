import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { DiscoveryBackfillService } from '../../../app/discovery/discovery-backfill.service.js';
import { DiscoveryOutputPublisherService } from '../../../app/discovery/discovery-output-publisher.service.js';
import { DiscoveryProgressService } from '../../../app/discovery/discovery-progress.service.js';
import { ApifyGoogleMapsProviderAdapter } from '../../outbound/apify/apify-google-maps-provider-adapter.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoDiscoveryBackfillRunRepository } from '../../outbound/mongodb/mongo-discovery-backfill-run-repository.js';
import { MongoDiscoveryOutputRepository } from '../../outbound/mongodb/mongo-discovery-output-repository.js';
import { MongoDiscoveryStateRepository } from '../../outbound/mongodb/mongo-discovery-state-repository.js';
import { MongoLeadRepository } from '../../outbound/mongodb/mongo-lead-repository.js';
import { MongoProviderQuotaRepository } from '../../outbound/mongodb/mongo-provider-quota-repository.js';
import { RabbitMqConnectionVerifier } from '../../outbound/rabbitmq/rabbitmq-connection-verifier.js';
import { RabbitMqDiscoveredLeadMessagePublisher } from '../../outbound/rabbitmq/rabbitmq-discovered-lead-message-publisher.js';
import { SystemClock } from '../../outbound/time/system-clock.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import { DiscoveryCampaignConfiguration } from '../configuration/discovery-campaign-configuration.js';
import { DiscoveryOutputPublisherWorker } from '../scheduler/discovery-output-publisher-worker.js';
import { DiscoveryWorker } from '../scheduler/discovery-worker.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  imports: [ScheduleModule.forRoot()],
  providers: [
    DiscoveryCampaignConfiguration,
    DiscoveryRuntimeConfiguration,
    MongoDatabaseClient,
    MongoDiscoveryBackfillRunRepository,
    MongoDiscoveryOutputRepository,
    MongoDiscoveryStateRepository,
    MongoLeadRepository,
    MongoProviderQuotaRepository,
    RabbitMqConnectionVerifier,
    RabbitMqDiscoveredLeadMessagePublisher,
    SystemClock,
    {
      inject: [
        DiscoveryCampaignConfiguration,
        SystemClock,
        MongoDiscoveryBackfillRunRepository,
        MongoDiscoveryOutputRepository,
        MongoLeadRepository,
      ],
      provide: DiscoveryBackfillService,
      useFactory: (
        campaignConfiguration: DiscoveryCampaignConfiguration,
        clock: SystemClock,
        backfillRunRepository: MongoDiscoveryBackfillRunRepository,
        discoveryOutputRepository: MongoDiscoveryOutputRepository,
        leadRepository: MongoLeadRepository,
      ): DiscoveryBackfillService => new DiscoveryBackfillService(
        campaignConfiguration,
        clock,
        backfillRunRepository,
        discoveryOutputRepository,
        leadRepository,
      ),
    },
    {
      inject: [DiscoveryProgressService],
      provide: DiscoveryWorker,
      useFactory: (
        discoveryProgressService: DiscoveryProgressService,
      ): DiscoveryWorker => new DiscoveryWorker(discoveryProgressService),
    },
    {
      inject: [DiscoveryOutputPublisherService, DiscoveryRuntimeConfiguration],
      provide: DiscoveryOutputPublisherWorker,
      useFactory: (
        discoveryOutputPublisherService: DiscoveryOutputPublisherService,
        runtimeConfiguration: DiscoveryRuntimeConfiguration,
      ): DiscoveryOutputPublisherWorker =>
        new DiscoveryOutputPublisherWorker(
          discoveryOutputPublisherService,
          runtimeConfiguration,
        ),
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
    {
      inject: [
        SystemClock,
        MongoDiscoveryOutputRepository,
        RabbitMqDiscoveredLeadMessagePublisher,
      ],
      provide: DiscoveryOutputPublisherService,
      useFactory: (
        clock: SystemClock,
        discoveryOutputRepository: MongoDiscoveryOutputRepository,
        discoveredLeadMessagePublisher: RabbitMqDiscoveredLeadMessagePublisher,
      ): DiscoveryOutputPublisherService =>
        new DiscoveryOutputPublisherService(
          clock,
          discoveryOutputRepository,
          discoveredLeadMessagePublisher,
        ),
    },
  ],
})
export class BootstrapModule {}
