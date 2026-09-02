import { Module } from '@nestjs/common';

import { QualificationService } from '../../../app/qualification/qualification.service.js';
import { ConfigurationKnownAffiliationPolicy } from '../../outbound/configuration/configuration-known-affiliation-policy.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoQualificationDecisionRepository } from '../../outbound/mongodb/mongo-qualification-decision-repository.js';
import { MongoQualificationExecutionRepository } from '../../outbound/mongodb/mongo-qualification-execution-repository.js';
import { MongoQualificationInboxRepository } from '../../outbound/mongodb/mongo-qualification-inbox-repository.js';
import { MongoQualifiedLeadOutputRepository } from '../../outbound/mongodb/mongo-qualified-lead-output-repository.js';
import { RabbitMqConnectionVerifier } from '../../outbound/rabbitmq/rabbitmq-connection-verifier.js';
import { QualificationRuntimeConfiguration } from '../bootstrap/qualification-runtime-configuration.js';
import { KnownAffiliationCatalogConfiguration } from '../configuration/known-affiliation-catalog-configuration.js';
import { QualificationProfileConfiguration } from '../configuration/qualification-profile-configuration.js';
import { RabbitMqDiscoveredLeadConsumer } from '../rabbitmq/rabbitmq-discovered-lead-consumer.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    QualificationRuntimeConfiguration,
    QualificationProfileConfiguration,
    KnownAffiliationCatalogConfiguration,
    ConfigurationKnownAffiliationPolicy,
    MongoDatabaseClient,
    MongoQualificationDecisionRepository,
    MongoQualificationExecutionRepository,
    MongoQualificationInboxRepository,
    MongoQualifiedLeadOutputRepository,
    RabbitMqConnectionVerifier,
    RabbitMqDiscoveredLeadConsumer,
    {
      provide: QualificationService,
      useFactory: (
        decisionRepository: MongoQualificationDecisionRepository,
        executionRepository: MongoQualificationExecutionRepository,
        inboxRepository: MongoQualificationInboxRepository,
        knownAffiliationPolicy: ConfigurationKnownAffiliationPolicy,
        profileConfiguration: QualificationProfileConfiguration,
        qualifiedLeadOutputRepository: MongoQualifiedLeadOutputRepository,
      ): QualificationService => new QualificationService(
        decisionRepository,
        executionRepository,
        inboxRepository,
        knownAffiliationPolicy,
        profileConfiguration,
        qualifiedLeadOutputRepository,
      ),
      inject: [
        MongoQualificationDecisionRepository,
        MongoQualificationExecutionRepository,
        MongoQualificationInboxRepository,
        ConfigurationKnownAffiliationPolicy,
        QualificationProfileConfiguration,
        MongoQualifiedLeadOutputRepository,
      ],
    },
  ],
})
export class BootstrapModule {}
