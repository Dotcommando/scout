import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { BootstrapModule } from './bootstrap.module.js';

const DISCOVERY_PORT = 3001;

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(BootstrapModule);

  await application.listen(DISCOVERY_PORT);
}

void bootstrap();
