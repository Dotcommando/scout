import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import { IQualificationEnrichmentSnapshot } from '../../../domain/enrichment/enrichment-model.js';
import { IQualificationEnrichmentSnapshotRepositoryPort } from '../../../ports/outbound/qualification-enrichment-snapshot-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

@Injectable()
export class MongoQualificationEnrichmentSnapshotRepository
  implements IQualificationEnrichmentSnapshotRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IQualificationEnrichmentSnapshot>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient.getDatabase().collection('qualification_enrichment_snapshots');
  }

  public async findSnapshot(campaignId: string, leadId: string, profileVersion: number): Promise<IQualificationEnrichmentSnapshot | null> {
    return this.collection.findOne({ campaignId, leadId, profileVersion });
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      { campaignId: 1, leadId: 1, profileVersion: 1 },
      { name: 'campaign_lead_profile_enrichment_unique', unique: true },
    );
  }

  public async saveSnapshot(snapshot: IQualificationEnrichmentSnapshot): Promise<void> {
    await this.collection.updateOne(
      { campaignId: snapshot.campaignId, leadId: snapshot.leadId, profileVersion: snapshot.profileVersion },
      { $setOnInsert: snapshot },
      { upsert: true },
    );
  }
}
