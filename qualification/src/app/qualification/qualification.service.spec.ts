import {
  IQualificationProfile,
  QUALIFICATION_EXECUTION_STATUS,
} from '../../domain/qualification/qualification-model.js';
import {
  IQualifyLeadInput,
  QUALIFY_LEAD_OUTCOME,
} from '../../ports/inbound/qualify-lead.use-case.js';
import {
  IKnownAffiliationPolicyPort,
} from '../../ports/outbound/known-affiliation-policy.port.js';
import {
  IQualificationDecisionRecord,
  IQualificationDecisionRepositoryPort,
} from '../../ports/outbound/qualification-decision-repository.port.js';
import {
  IClaimQualificationExecutionInput,
  ICompleteQualificationExecutionInput,
  IQualificationExecutionRepositoryPort,
  QUALIFICATION_EXECUTION_CLAIM_OUTCOME,
} from '../../ports/outbound/qualification-execution-repository.port.js';
import {
  IQualificationInboxRecord,
  IQualificationInboxRepositoryPort,
} from '../../ports/outbound/qualification-inbox-repository.port.js';
import { IQualificationProfileConfigurationPort } from '../../ports/outbound/qualification-profile-configuration.port.js';
import {
  IQualifiedLeadOutputRecord,
  IQualifiedLeadOutputRepositoryPort,
} from '../../ports/outbound/qualified-lead-output-repository.port.js';
import { QualificationService } from './qualification.service.js';

describe('QualificationService', () => {
  it('does not create a second decision or output for a duplicate event', async () => {
    const fixture = createFixture();
    const input = createInput();
    const first = await fixture.service.qualifyLead(input);
    const duplicate = await fixture.service.qualifyLead(input);

    expect(first.outcome).toBe(QUALIFY_LEAD_OUTCOME.COMPLETED);
    expect(duplicate.outcome).toBe(QUALIFY_LEAD_OUTCOME.ALREADY_COMPLETED);
    expect(fixture.decisionRepository.records).toHaveLength(1);
    expect(fixture.outputRepository.records).toHaveLength(1);
  });

  it('deliberately re-evaluates a lead after a profile version change', async () => {
    const fixture = createFixture();
    const input = createInput();

    await fixture.service.qualifyLead(input);
    fixture.configuration.profile = {
      ...fixture.configuration.profile,
      contentHash: 'profile-v2',
      version: 2,
    };
    const revised = await fixture.service.qualifyLead({
      ...input,
      eventId: 'event-2',
    });

    expect(revised.outcome).toBe(QUALIFY_LEAD_OUTCOME.COMPLETED);
    expect(revised.profileVersion).toBe(2);
    expect(fixture.decisionRepository.records).toHaveLength(2);
  });

  it('propagates persistence failures without completing the execution', async () => {
    const fixture = createFixture();

    fixture.decisionRepository.shouldFailWrites = true;

    await expect(fixture.service.qualifyLead(createInput())).rejects.toThrow(
      'decision persistence failed',
    );
    expect(fixture.executionRepository.completedCount).toBe(0);
  });
});

interface IFixture {
  readonly configuration: FakeProfileConfiguration;
  readonly decisionRepository: FakeDecisionRepository;
  readonly executionRepository: FakeExecutionRepository;
  readonly outputRepository: FakeQualifiedLeadOutputRepository;
  readonly service: QualificationService;
}

function createFixture(): IFixture {
  const configuration = new FakeProfileConfiguration();
  const decisionRepository = new FakeDecisionRepository();
  const executionRepository = new FakeExecutionRepository();
  const inboxRepository = new FakeInboxRepository();
  const knownAffiliationPolicy = new FakeKnownAffiliationPolicy();
  const outputRepository = new FakeQualifiedLeadOutputRepository();

  return {
    configuration,
    decisionRepository,
    executionRepository,
    outputRepository,
    service: new QualificationService(
      decisionRepository,
      executionRepository,
      inboxRepository,
      knownAffiliationPolicy,
      configuration,
      outputRepository,
    ),
  };
}

function createInput(): IQualifyLeadInput {
  return {
    campaignId: 'campaign-1',
    correlationId: 'correlation-1',
    eventId: 'event-1',
    lead: {
      externalId: 'external-1',
      leadId: 'lead-1',
      name: 'Example lead',
      sourceKind: 'directory',
    },
    occurredAt: new Date('2026-09-02T00:00:00.000Z'),
    workerId: 'worker-1',
  };
}

class FakeProfileConfiguration implements IQualificationProfileConfigurationPort {
  public profile: IQualificationProfile = {
    campaignId: 'campaign-1',
    contentHash: 'profile-v1',
    excludedSourceIdentities: [],
    excludedWebsiteHosts: [],
    profileId: 'baseline',
    requirements: {
      address: false,
      name: true,
      phoneNumber: false,
      websiteUrl: false,
    },
    version: 1,
  };

  public getProfile(): IQualificationProfile {
    return this.profile;
  }
}

class FakeInboxRepository implements IQualificationInboxRepositoryPort {
  public readonly records: IQualificationInboxRecord[] = [];

  public async recordInput(input: IQualificationInboxRecord): Promise<void> {
    if (!this.records.some((record) => record.eventId === input.eventId)) {
      this.records.push(input);
    }
  }
}

class FakeKnownAffiliationPolicy implements IKnownAffiliationPolicyPort {
  public findMatch() {
    return null;
  }
}

class FakeExecutionRepository implements IQualificationExecutionRepositoryPort {
  public completedCount = 0;
  private readonly records = new Map<string, QUALIFICATION_EXECUTION_STATUS>();

  public async claimExecution(
    input: IClaimQualificationExecutionInput,
  ): Promise<QUALIFICATION_EXECUTION_CLAIM_OUTCOME> {
    const key = this.createKey(input.campaignId, input.leadId, input.profileVersion);
    const status = this.records.get(key);

    if (status === QUALIFICATION_EXECUTION_STATUS.COMPLETED) {
      return QUALIFICATION_EXECUTION_CLAIM_OUTCOME.ALREADY_COMPLETED;
    }
    if (status === QUALIFICATION_EXECUTION_STATUS.PROCESSING) {
      return QUALIFICATION_EXECUTION_CLAIM_OUTCOME.IN_PROGRESS;
    }

    this.records.set(key, QUALIFICATION_EXECUTION_STATUS.PROCESSING);

    return QUALIFICATION_EXECUTION_CLAIM_OUTCOME.CLAIMED;
  }

  public async completeExecution(
    input: ICompleteQualificationExecutionInput,
  ): Promise<boolean> {
    const key = this.createKey(input.campaignId, input.leadId, input.profileVersion);

    if (this.records.get(key) !== QUALIFICATION_EXECUTION_STATUS.PROCESSING) {
      return false;
    }

    this.completedCount += 1;
    this.records.set(key, QUALIFICATION_EXECUTION_STATUS.COMPLETED);

    return true;
  }

  private createKey(
    campaignId: string,
    leadId: string,
    profileVersion: number,
  ): string {
    return `${campaignId}\u0000${leadId}\u0000${profileVersion}`;
  }
}

class FakeDecisionRepository implements IQualificationDecisionRepositoryPort {
  public readonly records: IQualificationDecisionRecord[] = [];
  public shouldFailWrites = false;

  public async findDecision(
    campaignId: string,
    leadId: string,
    profileVersion: number,
  ): Promise<IQualificationDecisionRecord | null> {
    return this.records.find(
      (record) => record.campaignId === campaignId
        && record.lead.leadId === leadId
        && record.profileVersion === profileVersion,
    ) ?? null;
  }

  public async saveDecision(input: IQualificationDecisionRecord): Promise<void> {
    if (this.shouldFailWrites) {
      throw new Error('decision persistence failed');
    }
    if (await this.findDecision(
      input.campaignId,
      input.lead.leadId,
      input.profileVersion,
    ) === null) {
      this.records.push(input);
    }
  }
}

class FakeQualifiedLeadOutputRepository
  implements IQualifiedLeadOutputRepositoryPort {
  public readonly records: IQualifiedLeadOutputRecord[] = [];

  public async saveQualifiedLeadOutput(
    input: IQualifiedLeadOutputRecord,
  ): Promise<void> {
    if (!this.records.some((record) => record.outputId === input.outputId)) {
      this.records.push(input);
    }
  }
}
