import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { QualificationRuntimeConfiguration } from '../bootstrap/qualification-runtime-configuration.js';
import {
  QualificationStructuredLogger,
  writeQualificationFailureLog,
  writeQualificationLog,
} from '../bootstrap/qualification-structured-logger.js';
import { BootstrapModule } from './bootstrap.module.js';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(BootstrapModule, {
    logger: new QualificationStructuredLogger(),
  });
  const runtimeConfiguration = application.get(
    QualificationRuntimeConfiguration,
  );

  application.enableShutdownHooks();
  await application.listen(runtimeConfiguration.port);

  writeQualificationLog({
    className: 'Main',
    correlationId: crypto.randomUUID(),
    level: 'info',
    method: 'bootstrap',
    operation: 'start-service',
    retryable: false,
    service: 'qualification',
  });
}

void bootstrap().catch((error: unknown) => {
  writeQualificationFailureLog({
    className: 'Main',
    correlationId: crypto.randomUUID(),
    error,
    method: 'bootstrap',
    operation: 'start-service',
    retryable: false,
  });

  process.exitCode = 1;
});
