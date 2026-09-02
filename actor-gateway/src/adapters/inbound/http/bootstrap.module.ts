import { Module } from '@nestjs/common';

import { ActorGatewayService } from '../../../app/actor/actor-gateway.service.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { VolatileActorRequestRepository } from '../../outbound/mongodb/volatile-actor-request-repository.js';
import { ActorGatewayRuntimeConfiguration } from '../bootstrap/actor-gateway-runtime-configuration.js';
import { ActorRequestController } from './actor-request.controller.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [ActorRequestController, HealthController],
  providers: [
    ActorGatewayRuntimeConfiguration,
    MongoDatabaseClient,
    VolatileActorRequestRepository,
    {
      inject: [VolatileActorRequestRepository],
      provide: ActorGatewayService,
      useFactory: (
        actorRequestRepository: VolatileActorRequestRepository,
      ): ActorGatewayService => new ActorGatewayService(actorRequestRepository),
    },
  ],
})
export class BootstrapModule {}
