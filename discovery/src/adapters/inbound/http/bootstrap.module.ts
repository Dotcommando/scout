import { Module } from '@nestjs/common';

import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [DiscoveryRuntimeConfiguration, MongoDatabaseClient],
})
export class BootstrapModule {}
