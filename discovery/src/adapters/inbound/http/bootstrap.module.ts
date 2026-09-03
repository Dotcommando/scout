import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { DiscoveryBackfillService } from '../../../app/discovery/discovery-backfill.service.js';
import { DiscoveryOutputPublisherService } from '../../../app/discovery/discovery-output-publisher.service.js';
import { DiscoveryProgressService } from '../../../app/discovery/discovery-progress.service.js';
import { GetDiscoveryConfigurationsService } from '../../../app/discovery/get-discovery-configurations.service.js';
import { GetDiscoveryLeadsService } from '../../../app/discovery/get-discovery-leads.service.js';
import { ManageDiscoveryConfigurationsService } from '../../../app/discovery/manage-discovery-configurations.service.js';
import { RequestDiscoveryRunService } from '../../../app/discovery/request-discovery-run.service.js';
import { GET_DISCOVERY_CONFIGURATIONS_USE_CASE } from '../../../ports/inbound/get-discovery-configurations.use-case.js';
import { GET_DISCOVERY_LEADS_USE_CASE } from '../../../ports/inbound/get-discovery-leads.use-case.js';
import { MANAGE_DISCOVERY_CONFIGURATIONS_USE_CASE } from '../../../ports/inbound/manage-discovery-configurations.use-case.js';
import { DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY } from '../../../ports/outbound/discovery-campaign-configuration-repository.port.js';
import { DISCOVERY_DAILY_START_REPOSITORY } from '../../../ports/outbound/discovery-daily-start-repository.port.js';
import { DISCOVERY_LEAD_READ_MODEL } from '../../../ports/outbound/discovery-lead-read-model.port.js';
import { ActorGatewayClient } from '../../outbound/actor-gateway/actor-gateway-client.js';
import { ActorGatewayGoogleMapsProviderAdapter } from '../../outbound/actor-gateway/actor-gateway-google-maps-provider-adapter.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoDiscoveryBackfillRunRepository } from '../../outbound/mongodb/mongo-discovery-backfill-run-repository.js';
import { MongoDiscoveryCampaignConfigurationRepository } from '../../outbound/mongodb/mongo-discovery-campaign-configuration-repository.js';
import { MongoDiscoveryDailyStartRepository } from '../../outbound/mongodb/mongo-discovery-daily-start-repository.js';
import { MongoDiscoveryLeadReadModel } from '../../outbound/mongodb/mongo-discovery-lead-read-model.js';
import { MongoDiscoveryOperationRunRepository } from '../../outbound/mongodb/mongo-discovery-operation-run-repository.js';
import { MongoDiscoveryOutputRepository } from '../../outbound/mongodb/mongo-discovery-output-repository.js';
import { MongoDiscoveryStateRepository } from '../../outbound/mongodb/mongo-discovery-state-repository.js';
import { MongoLeadRepository } from '../../outbound/mongodb/mongo-lead-repository.js';
import { MongoProviderQuotaRepository } from '../../outbound/mongodb/mongo-provider-quota-repository.js';
import { RabbitMqConnectionVerifier } from '../../outbound/rabbitmq/rabbitmq-connection-verifier.js';
import { RabbitMqDiscoveredLeadMessagePublisher } from '../../outbound/rabbitmq/rabbitmq-discovered-lead-message-publisher.js';
import { SystemClock } from '../../outbound/time/system-clock.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import { MongoDiscoveryCampaignConfiguration } from '../configuration/mongo-discovery-campaign-configuration.js';
import { DiscoveryOutputPublisherWorker } from '../scheduler/discovery-output-publisher-worker.js';
import { DiscoveryStartupCoordinator } from '../scheduler/discovery-startup-coordinator.js';
import { DiscoveryWorker } from '../scheduler/discovery-worker.js';
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
    {
      inject: [SystemClock, DISCOVERY_CAMPAIGN_CONFIGURATION_REPOSITORY],
      provide: MANAGE_DISCOVERY_CONFIGURATIONS_USE_CASE,
      useFactory: (
        clock: SystemClock,
        configurationRepository: MongoDiscoveryCampaignConfigurationRepository,
      ): ManageDiscoveryConfigurationsService => new ManageDiscoveryConfigurationsService(
        clock,
        configurationRepository,
      ),
    },
    MongoDiscoveryBackfillRunRepository,
    MongoDiscoveryDailyStartRepository,
    MongoDiscoveryLeadReadModel,
    MongoDiscoveryOutputRepository,
    MongoDiscoveryOperationRunRepository,
    MongoDiscoveryStateRepository,
    MongoLeadRepository,
    MongoProviderQuotaRepository,
    RabbitMqConnectionVerifier,
    RabbitMqDiscoveredLeadMessagePublisher,
    SystemClock,
    {
      inject: [DiscoveryRuntimeConfiguration],
      provide: ActorGatewayClient,
      useFactory: (runtimeConfiguration: DiscoveryRuntimeConfiguration): ActorGatewayClient =>
        new ActorGatewayClient(runtimeConfiguration),
    },
    {
      inject: [
        MongoDiscoveryCampaignConfiguration,
        SystemClock,
        MongoDiscoveryOperationRunRepository,
      ],
      provide: RequestDiscoveryRunService,
      useFactory: (
        campaignConfiguration: MongoDiscoveryCampaignConfiguration,
        clock: SystemClock,
        operationRunRepository: MongoDiscoveryOperationRunRepository,
      ): RequestDiscoveryRunService => new RequestDiscoveryRunService(
        campaignConfiguration,
        clock,
        operationRunRepository,
      ),
    },
    {
      inject: [ActorGatewayClient],
      provide: ActorGatewayGoogleMapsProviderAdapter,
      useFactory: (actorGatewayClient: ActorGatewayClient): ActorGatewayGoogleMapsProviderAdapter =>
        new ActorGatewayGoogleMapsProviderAdapter(actorGatewayClient),
    },
    {
      provide: DISCOVERY_DAILY_START_REPOSITORY,
      useExisting: MongoDiscoveryDailyStartRepository,
    },
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
      provide: DISCOVERY_LEAD_READ_MODEL,
      useExisting: MongoDiscoveryLeadReadModel,
    },
    {
      inject: [DISCOVERY_LEAD_READ_MODEL],
      provide: GET_DISCOVERY_LEADS_USE_CASE,
      useFactory: (
        readModel: MongoDiscoveryLeadReadModel,
      ): GetDiscoveryLeadsService => new GetDiscoveryLeadsService(readModel),
    },
    {
      inject: [
        MongoDiscoveryCampaignConfiguration,
        SystemClock,
        MongoDiscoveryOutputRepository,
        ActorGatewayGoogleMapsProviderAdapter,
        MongoLeadRepository,
        MongoDiscoveryStateRepository,
        MongoProviderQuotaRepository,
      ],
      provide: DiscoveryProgressService,
      useFactory: (
        campaignConfiguration: MongoDiscoveryCampaignConfiguration,
        clock: SystemClock,
        discoveryOutputRepository: MongoDiscoveryOutputRepository,
        discoveryProvider: ActorGatewayGoogleMapsProviderAdapter,
        leadRepository: MongoLeadRepository,
        scopeRepository: MongoDiscoveryStateRepository,
        quotaRepository: MongoProviderQuotaRepository,
      ): DiscoveryProgressService => new DiscoveryProgressService(
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
      inject: [DiscoveryProgressService, MongoDiscoveryOperationRunRepository],
      provide: DiscoveryWorker,
      useFactory: (
        discoveryProgressService: DiscoveryProgressService,
        operationRunRepository: MongoDiscoveryOperationRunRepository,
      ): DiscoveryWorker => new DiscoveryWorker(
        discoveryProgressService,
        operationRunRepository,
      ),
    },
    DiscoveryStartupCoordinator,
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
