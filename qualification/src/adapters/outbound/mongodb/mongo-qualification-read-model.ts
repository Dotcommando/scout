import { Injectable } from '@nestjs/common';
import { Collection } from 'mongodb';

import { ENRICHMENT_STATE, IQualificationEnrichmentSnapshot } from '../../../domain/enrichment/enrichment-model.js';
import { QUALIFICATION_DECISION } from '../../../domain/qualification/qualification-model.js';
import { IQualificationDecisionRecord } from '../../../ports/outbound/qualification-decision-repository.port.js';
import {
  IQualificationExecutionView,
  IQualificationLeadPage,
  IQualificationLeadView,
  IQualificationReadModelPort,
  IQualificationStatusCounts,
} from '../../../ports/outbound/qualification-read-model.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

@Injectable()
export class MongoQualificationReadModel implements IQualificationReadModelPort {
  private readonly decisions: Collection<IQualificationDecisionRecord>;
  private readonly enrichments: Collection<IQualificationEnrichmentSnapshot>;
  private readonly executions: Collection<IQualificationExecutionView>;
  private readonly inbox: Collection<{ readonly campaignId: string; readonly lead: { readonly leadId: string } }>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    const database = mongoDatabaseClient.getDatabase();

    this.decisions = database.collection('qualification_decisions');
    this.enrichments = database.collection('qualification_enrichment_snapshots');
    this.executions = database.collection('qualification_executions');
    this.inbox = database.collection('qualification_inbox');
  }

  public async findExecution(executionId: string): Promise<IQualificationExecutionView | undefined> {
    const execution = await this.executions.findOne({ executionId });

    return execution === null ? undefined : execution;
  }

  public async findLead(campaignId: string, leadId: string, profileVersion: number): Promise<IQualificationLeadView | undefined> {
    const decision = await this.decisions.findOne({ campaignId, 'lead.leadId': leadId, profileVersion });

    return decision === null ? undefined : this.createLeadView(decision);
  }

  public async getStatusCounts(campaignId: string, profileVersion: number): Promise<IQualificationStatusCounts> {
    const [leadIds, completed, processing, qualified, rejected, decisions] = await Promise.all([
      this.inbox.distinct('lead.leadId', { campaignId }),
      this.executions.countDocuments({ campaignId, profileVersion, status: 'completed' }),
      this.executions.countDocuments({ campaignId, profileVersion, status: 'processing' }),
      this.decisions.countDocuments({ campaignId, profileVersion, 'decision.decision': QUALIFICATION_DECISION.QUALIFIED }),
      this.decisions.countDocuments({ campaignId, profileVersion, 'decision.decision': QUALIFICATION_DECISION.REJECTED }),
      this.decisions.distinct('lead.leadId', { campaignId, profileVersion }),
    ]);
    const completedLeadIds = new Set(decisions);

    return {
      completed,
      processing,
      qualified,
      received: leadIds.length,
      rejected,
      remaining: leadIds.filter((leadId) => !completedLeadIds.has(leadId)).length,
    };
  }

  public async listExecutions(campaignId: string, offset: number, limit: number): Promise<{ readonly items: readonly IQualificationExecutionView[]; readonly total: number }> {
    const [items, total] = await Promise.all([
      this.executions.find({ campaignId }).sort({ completedAt: -1, leadId: 1 }).skip(offset).limit(limit).toArray(),
      this.executions.countDocuments({ campaignId }),
    ]);

    return { items, total };
  }

  public async listQualifiedLeads(campaignId: string, profileVersion: number, offset: number, limit: number): Promise<IQualificationLeadPage> {
    const filter = { campaignId, profileVersion, 'decision.decision': QUALIFICATION_DECISION.QUALIFIED };
    const [decisions, total] = await Promise.all([
      this.decisions.find(filter).sort({ recordedAt: -1, 'lead.leadId': 1 }).skip(offset).limit(limit).toArray(),
      this.decisions.countDocuments(filter),
    ]);

    return { items: await Promise.all(decisions.map((decision) => this.createLeadView(decision))), total };
  }

  private async createLeadView(decision: IQualificationDecisionRecord): Promise<IQualificationLeadView> {
    const enrichment = await this.enrichments.findOne({
      campaignId: decision.campaignId,
      leadId: decision.lead.leadId,
      profileVersion: decision.profileVersion,
    });

    return {
      decision,
      enrichment,
      enrichmentState: enrichment === null ? ENRICHMENT_STATE.PENDING : ENRICHMENT_STATE.AVAILABLE,
    };
  }
}
