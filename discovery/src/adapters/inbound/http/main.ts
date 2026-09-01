import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import {
  DiscoveryStructuredLogger,
  writeDiscoveryFailureLog,
  writeDiscoveryLog,
} from '../bootstrap/discovery-structured-logger.js';
import { BootstrapModule } from './bootstrap.module.js';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(BootstrapModule, {
    logger: new DiscoveryStructuredLogger(),
  });
  const runtimeConfiguration = application.get(DiscoveryRuntimeConfiguration);

  application.enableShutdownHooks();
  await application.listen(runtimeConfiguration.port);

  writeDiscoveryLog({
    className: 'Main',
    correlationId: crypto.randomUUID(),
    level: 'info',
    method: 'bootstrap',
    operation: 'start-service',
    retryable: false,
    service: 'discovery',
  });
}

void bootstrap().catch((error: unknown) => {
  writeDiscoveryFailureLog({
    className: 'Main',
    correlationId: crypto.randomUUID(),
    error,
    method: 'bootstrap',
    operation: 'start-service',
    retryable: false,
  });

  process.exitCode = 1;
});
