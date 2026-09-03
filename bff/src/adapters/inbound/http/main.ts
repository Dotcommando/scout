import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { BffRuntimeConfiguration } from '../bootstrap/bff-runtime-configuration.js';
import {
  BffStructuredLogger,
  writeBffFailureLog,
  writeBffLog,
} from '../bootstrap/bff-structured-logger.js';
import { BootstrapModule } from './bootstrap.module.js';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(BootstrapModule, {
    logger: new BffStructuredLogger(),
  });
  const runtimeConfiguration = application.get(BffRuntimeConfiguration);

  application.enableCors({
    origin: runtimeConfiguration.corsOrigins,
  });
  application.enableShutdownHooks();
  await application.listen(runtimeConfiguration.port, '0.0.0.0');

  writeBffLog({
    className: 'Main',
    correlationId: crypto.randomUUID(),
    level: 'info',
    method: 'bootstrap',
    operation: 'start-service',
    retryable: false,
    service: 'bff',
  });
}

void bootstrap().catch((error: unknown) => {
  writeBffFailureLog(
    'Main',
    crypto.randomUUID(),
    error,
    'bootstrap',
    'start-service',
  );
  process.exitCode = 1;
});
