import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MongoClient } from 'mongodb';

import { DiscoveryRuntimeConfiguration } from '../../inbound/bootstrap/discovery-runtime-configuration.js';
import {
  writeDiscoveryFailureLog,
  writeDiscoveryLog,
} from '../../inbound/bootstrap/discovery-structured-logger.js';

@Injectable()
export class MongoDatabaseClient implements OnModuleDestroy, OnModuleInit {
  private readonly client: MongoClient;

  public constructor(
    private readonly runtimeConfiguration: DiscoveryRuntimeConfiguration,
  ) {
    this.client = new MongoClient(runtimeConfiguration.mongodbUri);
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.close();

    writeDiscoveryLog({
      className: 'MongoDatabaseClient',
      correlationId: crypto.randomUUID(),
      level: 'info',
      method: 'onModuleDestroy',
      operation: 'close-mongodb-connection',
      retryable: false,
      service: 'discovery',
    });
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();

      writeDiscoveryLog({
        className: 'MongoDatabaseClient',
        correlationId: crypto.randomUUID(),
        level: 'info',
        method: 'onModuleInit',
        operation: 'connect-mongodb',
        retryable: true,
        service: 'discovery',
      });
    } catch (error: unknown) {
      writeDiscoveryFailureLog({
        className: 'MongoDatabaseClient',
        correlationId: crypto.randomUUID(),
        error,
        method: 'onModuleInit',
        operation: 'connect-mongodb',
        retryable: true,
      });

      throw error;
    }
  }

  public async verifyConnection(): Promise<void> {
    await this.client.db().command({ ping: 1 });
  }
}
