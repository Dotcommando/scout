import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { ActorGatewayRuntimeConfiguration } from '../bootstrap/actor-gateway-runtime-configuration.js';
import {
  ActorGatewayStructuredLogger,
  writeActorGatewayFailureLog,
  writeActorGatewayLog,
} from '../bootstrap/actor-gateway-structured-logger.js';
import { BootstrapModule } from './bootstrap.module.js';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(BootstrapModule, {
    logger: new ActorGatewayStructuredLogger(),
  });
  const runtimeConfiguration = application.get(ActorGatewayRuntimeConfiguration);

  application.enableShutdownHooks();
  await application.listen(runtimeConfiguration.port);

  writeActorGatewayLog({
    className: 'Main',
    correlationId: crypto.randomUUID(),
    level: 'info',
    method: 'bootstrap',
    operation: 'start-service',
    retryable: false,
    service: 'actor-gateway',
  });
}

void bootstrap().catch((error: unknown) => {
  writeActorGatewayFailureLog({
    className: 'Main',
    correlationId: crypto.randomUUID(),
    error,
    method: 'bootstrap',
    operation: 'start-service',
    retryable: false,
  });

  process.exitCode = 1;
});
