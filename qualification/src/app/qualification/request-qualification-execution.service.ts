import { createHash } from 'node:crypto';

import { IQualifyLeadUseCase } from '../../ports/inbound/qualify-lead.use-case.js';
import { IQualificationExecutionCommand, IRequestQualificationExecutionInput, IRequestQualificationExecutionUseCase } from '../../ports/inbound/request-qualification-execution.use-case.js';
import { IClockPort } from '../../ports/outbound/clock.port.js';
import { IQualificationInboxRepositoryPort } from '../../ports/outbound/qualification-inbox-repository.port.js';
import { IQualificationProfileConfigurationPort } from '../../ports/outbound/qualification-profile-configuration.port.js';

export class QualificationLeadNotFoundError extends Error {
  public constructor(campaignId: string, leadId: string) {
    super(`Qualification Lead ${leadId} for campaign ${campaignId} was not found in the inbox`);
    this.name = 'QualificationLeadNotFoundError';
  }
}

export class RequestQualificationExecutionService implements IRequestQualificationExecutionUseCase {
  public constructor(
    private readonly clock: IClockPort,
    private readonly inboxRepository: IQualificationInboxRepositoryPort,
    private readonly profileConfiguration: IQualificationProfileConfigurationPort,
    private readonly qualifyLeadUseCase: IQualifyLeadUseCase,
  ) {}

  public async requestExecution(input: IRequestQualificationExecutionInput): Promise<IQualificationExecutionCommand> {
    const profile = this.profileConfiguration.getProfile(input.campaignId);

    if (input.profileVersion !== undefined && input.profileVersion !== profile.version) {
      throw new Error(`profileVersion ${input.profileVersion} is not the active profile revision`);
    }

    const inbox = await this.inboxRepository.findInput(input.campaignId, input.leadId);

    if (inbox === undefined) {
      throw new QualificationLeadNotFoundError(input.campaignId, input.leadId);
    }

    const qualification = await this.qualifyLeadUseCase.qualifyLead({
      campaignId: input.campaignId,
      correlationId: input.correlationId,
      eventId: inbox.eventId,
      lead: inbox.lead,
      occurredAt: this.clock.getCurrentTime(),
      workerId: `operator:${input.idempotencyKey ?? input.correlationId}`,
    });

    return {
      campaignId: input.campaignId,
      executionId: createExecutionId(input.campaignId, input.leadId, profile.version),
      leadId: input.leadId,
      qualification,
    };
  }
}

function createExecutionId(campaignId: string, leadId: string, profileVersion: number): string {
  return `qualification-execution-${createHash('sha256').update(`${campaignId}\u0000${leadId}\u0000${profileVersion}`).digest('hex')}`;
}
