import { Module } from '@nestjs/common';

import { ActorExecutionService } from '../../../app/actor/actor-execution.service.js';
import { ActorGatewayService } from '../../../app/actor/actor-gateway.service.js';
import { ApifyActorProviderAdapter } from '../../outbound/apify/apify-actor-provider-adapter.js';
import { MongoActorRequestRepository } from '../../outbound/mongodb/mongo-actor-request-repository.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { ActorGatewayRuntimeConfiguration } from '../bootstrap/actor-gateway-runtime-configuration.js';
import { ActorRequestController } from './actor-request.controller.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [ActorRequestController, HealthController],
  providers: [
    ActorGatewayRuntimeConfiguration,
    MongoDatabaseClient,
    MongoActorRequestRepository,
    {
      inject: [ActorGatewayRuntimeConfiguration],
      provide: ApifyActorProviderAdapter,
      useFactory: (configuration: ActorGatewayRuntimeConfiguration): ApifyActorProviderAdapter =>
        new ApifyActorProviderAdapter(configuration.apifyApiToken),
    },
    {
      inject: [ApifyActorProviderAdapter, MongoActorRequestRepository],
      provide: ActorExecutionService,
      useFactory: (
        actorProvider: ApifyActorProviderAdapter,
        actorRequestRepository: MongoActorRequestRepository,
      ): ActorExecutionService => new ActorExecutionService(
        actorProvider,
        actorRequestRepository,
      ),
    },
    {
      inject: [MongoActorRequestRepository, ActorExecutionService],
      provide: ActorGatewayService,
      useFactory: (
        actorRequestRepository: MongoActorRequestRepository,
        actorExecutionService: ActorExecutionService,
      ): ActorGatewayService => new ActorGatewayService(
        actorRequestRepository,
        actorExecutionService,
      ),
    },
  ],
})
export class BootstrapModule {}
