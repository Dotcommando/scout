import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db, MongoClient } from 'mongodb';

import { QualificationRuntimeConfiguration } from '../../inbound/bootstrap/qualification-runtime-configuration.js';
import {
  writeQualificationFailureLog,
  writeQualificationLog,
} from '../../inbound/bootstrap/qualification-structured-logger.js';

@Injectable()
export class MongoDatabaseClient implements OnModuleDestroy, OnModuleInit {
  private readonly client: MongoClient;

  public constructor(
    private readonly runtimeConfiguration: QualificationRuntimeConfiguration,
  ) {
    this.client = new MongoClient(runtimeConfiguration.mongodbUri);
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.close();

    writeQualificationLog({
      className: 'MongoDatabaseClient',
      correlationId: crypto.randomUUID(),
      level: 'info',
      method: 'onModuleDestroy',
      operation: 'close-mongodb-connection',
      retryable: false,
      service: 'qualification',
    });
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();

      writeQualificationLog({
        className: 'MongoDatabaseClient',
        correlationId: crypto.randomUUID(),
        level: 'info',
        method: 'onModuleInit',
        operation: 'connect-mongodb',
        retryable: true,
        service: 'qualification',
      });
    } catch (error: unknown) {
      writeQualificationFailureLog({
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

  public getDatabase(): Db {
    return this.client.db();
  }
}
