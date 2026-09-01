import { Module } from '@nestjs/common';

import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { QualificationRuntimeConfiguration } from '../bootstrap/qualification-runtime-configuration.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [QualificationRuntimeConfiguration, MongoDatabaseClient],
})
export class BootstrapModule {}
