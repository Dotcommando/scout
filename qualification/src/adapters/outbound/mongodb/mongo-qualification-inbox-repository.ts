import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import { IQualificationInboxRecord } from '../../../ports/outbound/qualification-inbox-repository.port.js';
import { IQualificationInboxRepositoryPort } from '../../../ports/outbound/qualification-inbox-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

@Injectable()
export class MongoQualificationInboxRepository
  implements IQualificationInboxRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IQualificationInboxRecord>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient
      .getDatabase()
      .collection('qualification_inbox');
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      { eventId: 1 },
      { name: 'qualification_event_id_unique', unique: true },
    );
  }

  public async recordInput(input: IQualificationInboxRecord): Promise<void> {
    await this.collection.updateOne(
      { eventId: input.eventId },
      { $setOnInsert: input },
      { upsert: true },
    );
  }
}
