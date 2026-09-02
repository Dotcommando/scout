import { Module } from '@nestjs/common';

import { ActorGatewayService } from '../../../app/actor/actor-gateway.service.js';
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
      inject: [MongoActorRequestRepository],
      provide: ActorGatewayService,
      useFactory: (
        actorRequestRepository: MongoActorRequestRepository,
      ): ActorGatewayService => new ActorGatewayService(actorRequestRepository),
    },
  ],
})
export class BootstrapModule {}
