import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import { IDiscoveryOutputPayload } from '../../../app/discovery/discovery-output-payload.js';
import {
  DISCOVERY_LEAD_SORT_BY,
  IDiscoveryLeadListInput,
  IDiscoveryLeadListPage,
  IDiscoveryLeadReadModelPort,
  LEAD_SORT_DIRECTION,
} from '../../../ports/outbound/discovery-lead-read-model.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface IDiscoveryOutputDocument {
  readonly campaignId: string;
  readonly createdAt: Date;
  readonly leadId: string;
  readonly payload?: IDiscoveryOutputPayload;
}

@Injectable()
export class MongoDiscoveryLeadReadModel
  implements IDiscoveryLeadReadModelPort, OnModuleInit {
  private readonly collection: Collection<IDiscoveryOutputDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient.getDatabase().collection('discovery_outputs');
  }

  public async onModuleInit(): Promise<void> {
    await Promise.all([
      this.collection.createIndex(
        { campaignId: 1, createdAt: -1, leadId: 1 },
        { name: 'campaign_lead_created_at' },
      ),
      this.collection.createIndex(
        { campaignId: 1, 'payload.lead.name': 1, leadId: 1 },
        { name: 'campaign_lead_name' },
      ),
    ]);
  }

  public async listLeads(input: IDiscoveryLeadListInput): Promise<IDiscoveryLeadListPage> {
    const filter = { campaignId: input.campaignId, payload: { $exists: true } };
    const cursor = this.collection.find(filter);
    const direction = input.sortDirection === LEAD_SORT_DIRECTION.ASC ? 1 : -1;

    if (input.sortBy === DISCOVERY_LEAD_SORT_BY.NAME) {
      cursor.sort({ 'payload.lead.name': direction, leadId: 1 });
    } else {
      cursor.sort({ createdAt: direction, leadId: 1 });
    }

    const [documents, total] = await Promise.all([
      cursor.skip(input.offset).limit(input.limit).toArray(),
      this.collection.countDocuments(filter),
    ]);

    return {
      items: documents
        .flatMap((document) => document.payload === undefined
          ? []
          : [toLeadListItem(document, document.payload)]),
      total,
    };
  }
}

function toLeadListItem(
  document: IDiscoveryOutputDocument,
  payload: IDiscoveryOutputPayload,
) {
  return {
    ...(payload.lead.address === undefined ? {} : { address: payload.lead.address }),
    createdAt: document.createdAt,
    externalId: payload.lead.externalId,
    leadId: payload.lead.leadId,
    name: payload.lead.name,
    ...(payload.lead.phoneNumber === undefined
      ? {}
      : { phoneNumber: payload.lead.phoneNumber }),
    sourceKind: payload.lead.sourceKind,
    ...(payload.lead.websiteUrl === undefined
      ? {}
      : { websiteUrl: payload.lead.websiteUrl }),
  };
}
