import { Module } from '@nestjs/common';

import { QualificationService } from '../../../app/qualification/qualification.service.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoQualificationDecisionRepository } from '../../outbound/mongodb/mongo-qualification-decision-repository.js';
import { MongoQualificationExecutionRepository } from '../../outbound/mongodb/mongo-qualification-execution-repository.js';
import { MongoQualificationInboxRepository } from '../../outbound/mongodb/mongo-qualification-inbox-repository.js';
import { MongoQualifiedLeadOutputRepository } from '../../outbound/mongodb/mongo-qualified-lead-output-repository.js';
import { RabbitMqConnectionVerifier } from '../../outbound/rabbitmq/rabbitmq-connection-verifier.js';
import { QualificationRuntimeConfiguration } from '../bootstrap/qualification-runtime-configuration.js';
import { QualificationProfileConfiguration } from '../configuration/qualification-profile-configuration.js';
import { RabbitMqDiscoveredLeadConsumer } from '../rabbitmq/rabbitmq-discovered-lead-consumer.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    QualificationRuntimeConfiguration,
    QualificationProfileConfiguration,
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
        profileConfiguration: QualificationProfileConfiguration,
        qualifiedLeadOutputRepository: MongoQualifiedLeadOutputRepository,
      ): QualificationService => new QualificationService(
        decisionRepository,
        executionRepository,
        inboxRepository,
        profileConfiguration,
        qualifiedLeadOutputRepository,
      ),
      inject: [
        MongoQualificationDecisionRepository,
        MongoQualificationExecutionRepository,
        MongoQualificationInboxRepository,
        QualificationProfileConfiguration,
        MongoQualifiedLeadOutputRepository,
      ],
    },
  ],
})
export class BootstrapModule {}
