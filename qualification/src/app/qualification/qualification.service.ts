import { createHash } from 'node:crypto';

import {
  Lead,
  QUALIFICATION_DECISION,
  QUALIFICATION_INPUT_STATUS,
  QUALIFIED_OUTPUT_STATUS,
} from '../../domain/qualification/qualification-model.js';
import { evaluateQualificationProfile } from '../../domain/qualification/qualification-rule-evaluator.js';
import {
  IQualifyLeadInput,
  IQualifyLeadResult,
  IQualifyLeadUseCase,
  QUALIFY_LEAD_OUTCOME,
} from '../../ports/inbound/qualify-lead.use-case.js';
import {
  IQualificationDecisionRepositoryPort,
} from '../../ports/outbound/qualification-decision-repository.port.js';
import {
  IQualificationExecutionRepositoryPort,
  QUALIFICATION_EXECUTION_CLAIM_OUTCOME,
} from '../../ports/outbound/qualification-execution-repository.port.js';
import {
  IQualificationInboxRepositoryPort,
} from '../../ports/outbound/qualification-inbox-repository.port.js';
import {
  IQualificationProfileConfigurationPort,
} from '../../ports/outbound/qualification-profile-configuration.port.js';
import {
  IQualifiedLeadOutputRepositoryPort,
} from '../../ports/outbound/qualified-lead-output-repository.port.js';

const EXECUTION_CLAIM_STALE_MILLISECONDS = 5 * 60 * 1000;

export class QualificationService implements IQualifyLeadUseCase {
  public constructor(
    private readonly decisionRepository: IQualificationDecisionRepositoryPort,
    private readonly executionRepository: IQualificationExecutionRepositoryPort,
    private readonly inboxRepository: IQualificationInboxRepositoryPort,
    private readonly profileConfiguration: IQualificationProfileConfigurationPort,
    private readonly qualifiedLeadOutputRepository: IQualifiedLeadOutputRepositoryPort,
  ) {}

  public async qualifyLead(
    input: IQualifyLeadInput,
  ): Promise<IQualifyLeadResult> {
    new Lead(input.lead);

    const profile = this.profileConfiguration.getProfile(input.campaignId);

    await this.inboxRepository.recordInput({
      campaignId: input.campaignId,
      correlationId: input.correlationId,
      eventId: input.eventId,
      lead: input.lead,
      occurredAt: input.occurredAt,
      receivedAt: input.occurredAt,
      status: QUALIFICATION_INPUT_STATUS.RECEIVED,
    });

    const claimOutcome = await this.executionRepository.claimExecution({
      campaignId: input.campaignId,
      claimedAt: input.occurredAt,
      leadId: input.lead.leadId,
      profileVersion: profile.version,
      staleClaimBefore: new Date(
        input.occurredAt.getTime() - EXECUTION_CLAIM_STALE_MILLISECONDS,
      ),
      workerId: input.workerId,
    });

    if (claimOutcome === QUALIFICATION_EXECUTION_CLAIM_OUTCOME.IN_PROGRESS) {
      return {
        outcome: QUALIFY_LEAD_OUTCOME.IN_PROGRESS,
        profileVersion: profile.version,
      };
    }
    if (
      claimOutcome === QUALIFICATION_EXECUTION_CLAIM_OUTCOME.ALREADY_COMPLETED
    ) {
      const existingDecision = await this.decisionRepository.findDecision(
        input.campaignId,
        input.lead.leadId,
        profile.version,
      );

      if (existingDecision === null) {
        throw new Error('completed qualification execution has no decision record');
      }

      return {
        decision: existingDecision.decision,
        outcome: QUALIFY_LEAD_OUTCOME.ALREADY_COMPLETED,
        profileVersion: profile.version,
      };
    }

    const decision = evaluateQualificationProfile(profile, input.lead);

    await this.decisionRepository.saveDecision({
      campaignId: input.campaignId,
      decision,
      eventId: input.eventId,
      lead: input.lead,
      profileContentHash: profile.contentHash,
      profileId: profile.profileId,
      profileVersion: profile.version,
      recordedAt: input.occurredAt,
    });

    if (decision.decision === QUALIFICATION_DECISION.QUALIFIED) {
      await this.qualifiedLeadOutputRepository.saveQualifiedLeadOutput({
        campaignId: input.campaignId,
        createdAt: input.occurredAt,
        decisionEventId: input.eventId,
        lead: input.lead,
        outputId: createQualifiedLeadOutputId(
          input.campaignId,
          input.lead.leadId,
          profile.version,
        ),
        profileVersion: profile.version,
        status: QUALIFIED_OUTPUT_STATUS.READY,
      });
    }

    const completed = await this.executionRepository.completeExecution({
      campaignId: input.campaignId,
      completedAt: input.occurredAt,
      leadId: input.lead.leadId,
      profileVersion: profile.version,
      workerId: input.workerId,
    });

    if (!completed) {
      throw new Error('qualification execution claim was lost before completion');
    }

    return {
      decision,
      outcome: QUALIFY_LEAD_OUTCOME.COMPLETED,
      profileVersion: profile.version,
    };
  }
}

function createQualifiedLeadOutputId(
  campaignId: string,
  leadId: string,
  profileVersion: number,
): string {
  const hash = createHash('sha256')
    .update(`${campaignId}\u0000${leadId}\u0000${profileVersion}`)
    .digest('hex');

  return `qualified-lead-output-${hash}`;
}
