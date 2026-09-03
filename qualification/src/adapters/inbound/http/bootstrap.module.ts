import { Module } from '@nestjs/common';

import { QualificationEnrichmentService } from '../../../app/enrichment/qualification-enrichment.service.js';
import { QualificationService } from '../../../app/qualification/qualification.service.js';
import { ActorGatewayClient } from '../../outbound/actor-gateway/actor-gateway-client.js';
import { ConfigurationKnownAffiliationPolicy } from '../../outbound/configuration/configuration-known-affiliation-policy.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoQualificationDecisionRepository } from '../../outbound/mongodb/mongo-qualification-decision-repository.js';
import { MongoQualificationEnrichmentSnapshotRepository } from '../../outbound/mongodb/mongo-qualification-enrichment-snapshot-repository.js';
import { MongoQualificationExecutionRepository } from '../../outbound/mongodb/mongo-qualification-execution-repository.js';
import { MongoQualificationInboxRepository } from '../../outbound/mongodb/mongo-qualification-inbox-repository.js';
import { MongoQualifiedLeadOutputRepository } from '../../outbound/mongodb/mongo-qualified-lead-output-repository.js';
import { RabbitMqConnectionVerifier } from '../../outbound/rabbitmq/rabbitmq-connection-verifier.js';
import { QualificationRuntimeConfiguration } from '../bootstrap/qualification-runtime-configuration.js';
import { KnownAffiliationCatalogConfiguration } from '../configuration/known-affiliation-catalog-configuration.js';
import { MongoQualificationConfiguration } from '../configuration/mongo-qualification-configuration.js';
import { QualificationEnrichmentConfiguration } from '../configuration/qualification-enrichment-configuration.js';
import { QualificationProfileConfiguration } from '../configuration/qualification-profile-configuration.js';
import { RabbitMqDiscoveredLeadConsumer } from '../rabbitmq/rabbitmq-discovered-lead-consumer.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    QualificationRuntimeConfiguration,
    MongoQualificationConfiguration,
    {
      provide: QualificationProfileConfiguration,
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
    MongoQualificationDecisionRepository,
    MongoQualificationExecutionRepository,
    MongoQualificationEnrichmentSnapshotRepository,
    MongoQualificationInboxRepository,
    MongoQualifiedLeadOutputRepository,
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
