import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import {
  IQualifiedLeadOutputRecord,
  IQualifiedLeadOutputRepositoryPort,
} from '../../../ports/outbound/qualified-lead-output-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

@Injectable()
export class MongoQualifiedLeadOutputRepository
  implements IQualifiedLeadOutputRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IQualifiedLeadOutputRecord>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient
      .getDatabase()
      .collection('qualified_lead_outputs');
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      {
        campaignId: 1,
        'lead.leadId': 1,
        profileVersion: 1,
      },
      {
        name: 'campaign_lead_profile_output_unique',
        unique: true,
      },
    );
    await this.collection.createIndex(
      { outputId: 1 },
      { name: 'qualified_output_id_unique', unique: true },
    );
  }

  public async saveQualifiedLeadOutput(
    input: IQualifiedLeadOutputRecord,
  ): Promise<void> {
    await this.collection.updateOne(
      {
        campaignId: input.campaignId,
        'lead.leadId': input.lead.leadId,
        profileVersion: input.profileVersion,
      },
      { $setOnInsert: input },
      { upsert: true },
    );
  }
}
