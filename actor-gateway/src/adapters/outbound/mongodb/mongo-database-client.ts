import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db, MongoClient } from 'mongodb';

import { ActorGatewayRuntimeConfiguration } from '../../inbound/bootstrap/actor-gateway-runtime-configuration.js';
import {
  writeActorGatewayFailureLog,
  writeActorGatewayLog,
} from '../../inbound/bootstrap/actor-gateway-structured-logger.js';

@Injectable()
export class MongoDatabaseClient implements OnModuleDestroy, OnModuleInit {
  private readonly client: MongoClient;

  public constructor(
    private readonly runtimeConfiguration: ActorGatewayRuntimeConfiguration,
  ) {
    this.client = new MongoClient(runtimeConfiguration.mongodbUri);
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.close();

    writeActorGatewayLog({
      className: 'MongoDatabaseClient',
      correlationId: crypto.randomUUID(),
      level: 'info',
      method: 'onModuleDestroy',
      operation: 'close-mongodb-connection',
      retryable: false,
      service: 'actor-gateway',
    });
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();

      writeActorGatewayLog({
        className: 'MongoDatabaseClient',
        correlationId: crypto.randomUUID(),
        level: 'info',
        method: 'onModuleInit',
        operation: 'connect-mongodb',
        retryable: true,
        service: 'actor-gateway',
      });
    } catch (error: unknown) {
      writeActorGatewayFailureLog({
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

  public getDatabase(): Db {
    return this.client.db();
  }

  public async verifyConnection(): Promise<void> {
    await this.client.db().command({ ping: 1 });
  }
}
