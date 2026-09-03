import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { DiscoveryBackfillService } from '../../../app/discovery/discovery-backfill.service.js';
import { DiscoveryOutputPublisherService } from '../../../app/discovery/discovery-output-publisher.service.js';
import { GetDiscoveryConfigurationsService } from '../../../app/discovery/get-discovery-configurations.service.js';
import { GET_DISCOVERY_CONFIGURATIONS_USE_CASE } from '../../../ports/inbound/get-discovery-configurations.use-case.js';
import { DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY } from '../../../ports/outbound/discovery-campaign-configuration-repository.port.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoDiscoveryBackfillRunRepository } from '../../outbound/mongodb/mongo-discovery-backfill-run-repository.js';
import { MongoDiscoveryCampaignConfigurationRepository } from '../../outbound/mongodb/mongo-discovery-campaign-configuration-repository.js';
import { MongoDiscoveryOutputRepository } from '../../outbound/mongodb/mongo-discovery-output-repository.js';
import { MongoLeadRepository } from '../../outbound/mongodb/mongo-lead-repository.js';
import { RabbitMqConnectionVerifier } from '../../outbound/rabbitmq/rabbitmq-connection-verifier.js';
import { RabbitMqDiscoveredLeadMessagePublisher } from '../../outbound/rabbitmq/rabbitmq-discovered-lead-message-publisher.js';
import { SystemClock } from '../../outbound/time/system-clock.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import { MongoDiscoveryCampaignConfiguration } from '../configuration/mongo-discovery-campaign-configuration.js';
import { DiscoveryOutputPublisherWorker } from '../scheduler/discovery-output-publisher-worker.js';
import { DiscoveryConfigurationController } from './discovery-configuration.controller.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [DiscoveryConfigurationController, HealthController],
  imports: [ScheduleModule.forRoot()],
  providers: [
    MongoDiscoveryCampaignConfiguration,
    DiscoveryRuntimeConfiguration,
    MongoDatabaseClient,
    {
      provide: DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY,
      useClass: MongoDiscoveryCampaignConfigurationRepository,
    },
    MongoDiscoveryBackfillRunRepository,
    MongoDiscoveryOutputRepository,
    MongoLeadRepository,
    RabbitMqConnectionVerifier,
    RabbitMqDiscoveredLeadMessagePublisher,
    SystemClock,
    {
      inject: [DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY],
      provide: GET_DISCOVERY_CONFIGURATIONS_USE_CASE,
      useFactory: (
        configurationRepository: MongoDiscoveryCampaignConfigurationRepository,
      ): GetDiscoveryConfigurationsService => new GetDiscoveryConfigurationsService(
        configurationRepository,
      ),
    },
    {
      inject: [
        MongoDiscoveryCampaignConfiguration,
        SystemClock,
        MongoDiscoveryBackfillRunRepository,
        MongoDiscoveryOutputRepository,
        MongoLeadRepository,
      ],
      provide: DiscoveryBackfillService,
      useFactory: (
        campaignConfiguration: MongoDiscoveryCampaignConfiguration,
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
