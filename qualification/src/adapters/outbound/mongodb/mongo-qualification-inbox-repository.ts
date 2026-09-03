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
    await this.collection.createIndex(
      { campaignId: 1, 'lead.leadId': 1 },
      { name: 'qualification_campaign_lead_inbox' },
    );
  }

  public async findInput(campaignId: string, leadId: string): Promise<IQualificationInboxRecord | undefined> {
    const input = await this.collection.findOne({ campaignId, 'lead.leadId': leadId });

    return input === null ? undefined : input;
  }

  public async recordInput(input: IQualificationInboxRecord): Promise<void> {
    await this.collection.updateOne(
      { eventId: input.eventId },
      { $setOnInsert: input },
      { upsert: true },
    );
  }
}
