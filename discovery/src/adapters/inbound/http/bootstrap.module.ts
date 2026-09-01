import { Module } from '@nestjs/common';

import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoDiscoveryOutputRepository } from '../../outbound/mongodb/mongo-discovery-output-repository.js';
import { MongoDiscoveryStateRepository } from '../../outbound/mongodb/mongo-discovery-state-repository.js';
import { MongoLeadRepository } from '../../outbound/mongodb/mongo-lead-repository.js';
import { MongoProviderQuotaRepository } from '../../outbound/mongodb/mongo-provider-quota-repository.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import { DiscoveryCampaignConfiguration } from '../configuration/discovery-campaign-configuration.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
  providers: [
    DiscoveryCampaignConfiguration,
    DiscoveryRuntimeConfiguration,
    MongoDatabaseClient,
    MongoDiscoveryOutputRepository,
    MongoDiscoveryStateRepository,
    MongoLeadRepository,
    MongoProviderQuotaRepository,
  ],
})
export class BootstrapModule {}
