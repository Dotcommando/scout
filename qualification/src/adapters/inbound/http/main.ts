import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { BootstrapModule } from './bootstrap.module.js';

const QUALIFICATION_PORT = 3002;

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(BootstrapModule);

  await application.listen(QUALIFICATION_PORT);
}

void bootstrap();
