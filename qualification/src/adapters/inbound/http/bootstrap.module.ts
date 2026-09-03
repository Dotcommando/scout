import { Module } from '@nestjs/common';

import { QualificationEnrichmentService } from '../../../app/enrichment/qualification-enrichment.service.js';
import { GetQualificationConfigurationsService } from '../../../app/qualification/get-qualification-configurations.service.js';
import { GetQualificationOperationsService } from '../../../app/qualification/get-qualification-operations.service.js';
import { ManageQualificationConfigurationsService } from '../../../app/qualification/manage-qualification-configurations.service.js';
import { QualificationService } from '../../../app/qualification/qualification.service.js';
import { RequestQualificationExecutionService } from '../../../app/qualification/request-qualification-execution.service.js';
import { GET_QUALIFICATION_CONFIGURATIONS_USE_CASE } from '../../../ports/inbound/get-qualification-configurations.use-case.js';
import { GET_QUALIFICATION_OPERATIONS_USE_CASE } from '../../../ports/inbound/get-qualification-operations.use-case.js';
import { MANAGE_QUALIFICATION_CONFIGURATIONS_USE_CASE } from '../../../ports/inbound/manage-qualification-configurations.use-case.js';
import { REQUEST_QUALIFICATION_EXECUTION_USE_CASE } from '../../../ports/inbound/request-qualification-execution.use-case.js';
import { QUALIFICATION_CONFIGURATION_REPOSITORY } from '../../../ports/outbound/qualification-configuration-repository.port.js';
import { QUALIFICATION_CONFIGURATION_RUNTIME } from '../../../ports/outbound/qualification-configuration-runtime.port.js';
import { ActorGatewayClient } from '../../outbound/actor-gateway/actor-gateway-client.js';
import { ConfigurationKnownAffiliationPolicy } from '../../outbound/configuration/configuration-known-affiliation-policy.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoQualificationConfigurationRepository } from '../../outbound/mongodb/mongo-qualification-configuration-repository.js';
import { MongoQualificationDecisionRepository } from '../../outbound/mongodb/mongo-qualification-decision-repository.js';
import { MongoQualificationEnrichmentSnapshotRepository } from '../../outbound/mongodb/mongo-qualification-enrichment-snapshot-repository.js';
import { MongoQualificationExecutionRepository } from '../../outbound/mongodb/mongo-qualification-execution-repository.js';
import { MongoQualificationInboxRepository } from '../../outbound/mongodb/mongo-qualification-inbox-repository.js';
import { MongoQualificationReadModel } from '../../outbound/mongodb/mongo-qualification-read-model.js';
import { MongoQualifiedLeadOutputRepository } from '../../outbound/mongodb/mongo-qualified-lead-output-repository.js';
import { RabbitMqConnectionVerifier } from '../../outbound/rabbitmq/rabbitmq-connection-verifier.js';
import { SystemClock } from '../../outbound/time/system-clock.js';
import { QualificationRuntimeConfiguration } from '../bootstrap/qualification-runtime-configuration.js';
import { KnownAffiliationCatalogConfiguration } from '../configuration/known-affiliation-catalog-configuration.js';
import { MongoQualificationConfiguration } from '../configuration/mongo-qualification-configuration.js';
import { QualificationEnrichmentConfiguration } from '../configuration/qualification-enrichment-configuration.js';
import { QualificationProfileConfiguration } from '../configuration/qualification-profile-configuration.js';
import { RabbitMqDiscoveredLeadConsumer } from '../rabbitmq/rabbitmq-discovered-lead-consumer.js';
import { HealthController } from './health.controller.js';
import { QualificationConfigurationController } from './qualification-configuration.controller.js';
import { QualificationOperationsController } from './qualification-operations.controller.js';

@Module({
  controllers: [HealthController, QualificationConfigurationController, QualificationOperationsController],
  providers: [
    QualificationRuntimeConfiguration,
    MongoQualificationConfiguration,
    {
      provide: QUALIFICATION_CONFIGURATION_REPOSITORY,
      useClass: MongoQualificationConfigurationRepository,
    },
    {
      provide: QualificationProfileConfiguration,
      useExisting: MongoQualificationConfiguration,
    },
    {
      provide: QUALIFICATION_CONFIGURATION_RUNTIME,
      useExisting: MongoQualificationConfiguration,
    },
    {
      provide: QualificationEnrichmentConfiguration,
      useExisting: MongoQualificationConfiguration,
    },
    {
      provide: KnownAffiliationCatalogConfiguration,
      useExisting: MongoQualificationConfiguration,
    },
    ConfigurationKnownAffiliationPolicy,
    MongoDatabaseClient,
    SystemClock,
    MongoQualificationDecisionRepository,
    MongoQualificationExecutionRepository,
    MongoQualificationEnrichmentSnapshotRepository,
    MongoQualificationInboxRepository,
    MongoQualificationReadModel,
    MongoQualifiedLeadOutputRepository,
    {
      inject: [QUALIFICATION_CONFIGURATION_REPOSITORY],
      provide: GET_QUALIFICATION_CONFIGURATIONS_USE_CASE,
      useFactory: (repository: MongoQualificationConfigurationRepository): GetQualificationConfigurationsService =>
        new GetQualificationConfigurationsService(repository),
    },
    {
      inject: [SystemClock, MongoQualificationReadModel],
      provide: GET_QUALIFICATION_OPERATIONS_USE_CASE,
      useFactory: (clock: SystemClock, readModel: MongoQualificationReadModel): GetQualificationOperationsService =>
        new GetQualificationOperationsService(clock, readModel),
    },
    {
      inject: [SystemClock, MongoQualificationConfiguration, QUALIFICATION_CONFIGURATION_REPOSITORY, QUALIFICATION_CONFIGURATION_RUNTIME],
      provide: MANAGE_QUALIFICATION_CONFIGURATIONS_USE_CASE,
      useFactory: (
        clock: SystemClock,
        configuration: MongoQualificationConfiguration,
        repository: MongoQualificationConfigurationRepository,
        configurationRuntime: MongoQualificationConfiguration,
      ): ManageQualificationConfigurationsService => new ManageQualificationConfigurationsService(
        clock,
        configuration,
        repository,
        configurationRuntime,
      ),
    },
    {
      inject: [SystemClock, MongoQualificationInboxRepository, MongoQualificationConfiguration, QualificationService],
      provide: REQUEST_QUALIFICATION_EXECUTION_USE_CASE,
      useFactory: (
        clock: SystemClock,
        inboxRepository: MongoQualificationInboxRepository,
        profileConfiguration: MongoQualificationConfiguration,
        qualificationService: QualificationService,
      ): RequestQualificationExecutionService => new RequestQualificationExecutionService(
        clock,
        inboxRepository,
        profileConfiguration,
        qualificationService,
      ),
    },
    {
      provide: ActorGatewayClient,
      inject: [QualificationRuntimeConfiguration],
      useFactory: (runtimeConfiguration: QualificationRuntimeConfiguration): ActorGatewayClient =>
        new ActorGatewayClient(runtimeConfiguration),
    },
    RabbitMqConnectionVerifier,
    RabbitMqDiscoveredLeadConsumer,
    {
      provide: QualificationEnrichmentService,
      inject: [
        ActorGatewayClient,
        QualificationEnrichmentConfiguration,
        MongoQualificationEnrichmentSnapshotRepository,
      ],
      useFactory: (
        actorGatewayClient: ActorGatewayClient,
        enrichmentConfiguration: QualificationEnrichmentConfiguration,
        enrichmentSnapshotRepository: MongoQualificationEnrichmentSnapshotRepository,
      ): QualificationEnrichmentService => new QualificationEnrichmentService(
        actorGatewayClient,
        enrichmentConfiguration,
        enrichmentSnapshotRepository,
      ),
    },
    {
      provide: QualificationService,
      useFactory: (
        decisionRepository: MongoQualificationDecisionRepository,
        executionRepository: MongoQualificationExecutionRepository,
        inboxRepository: MongoQualificationInboxRepository,
        knownAffiliationPolicy: ConfigurationKnownAffiliationPolicy,
        profileConfiguration: QualificationProfileConfiguration,
        qualifiedLeadOutputRepository: MongoQualifiedLeadOutputRepository,
        qualificationEnrichmentService: QualificationEnrichmentService,
      ): QualificationService => new QualificationService(
        decisionRepository,
        executionRepository,
        inboxRepository,
        knownAffiliationPolicy,
        profileConfiguration,
        qualifiedLeadOutputRepository,
        qualificationEnrichmentService,
      ),
      inject: [
        MongoQualificationDecisionRepository,
        MongoQualificationExecutionRepository,
        MongoQualificationInboxRepository,
        ConfigurationKnownAffiliationPolicy,
        QualificationProfileConfiguration,
        MongoQualifiedLeadOutputRepository,
        QualificationEnrichmentService,
      ],
    },
  ],
})
export class BootstrapModule {}
