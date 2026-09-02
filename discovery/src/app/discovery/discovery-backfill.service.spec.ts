import {
  DISCOVERY_BACKFILL_RUN_STATUS,
  DISCOVERY_SOURCE_KIND,
  Lead,
  LeadSourceIdentity,
} from '../../domain/discovery/discovery-model.js';
import {
  IRunDiscoveryBackfillInput,
} from '../../ports/inbound/run-discovery-backfill.use-case.js';
import { IClockPort } from '../../ports/outbound/clock.port.js';
import {
  ICompleteDiscoveryBackfillRunInput,
  IDiscoveryBackfillRun,
  IDiscoveryBackfillRunRepositoryPort,
  IFailDiscoveryBackfillRunInput,
  IStartDiscoveryBackfillRunInput,
} from '../../ports/outbound/discovery-backfill-run-repository.port.js';
import { IDiscoveryCampaignConfigurationPort } from '../../ports/outbound/discovery-campaign-configuration.port.js';
import {
  DISCOVERY_OUTPUT_SAVE_OUTCOME,
  IClaimedDiscoveryOutput,
  IClaimPendingDiscoveryOutputsInput,
  IConfirmDiscoveryOutputPublicationInput,
  IDiscoveryOutputRepositoryPort,
  IRecordDiscoveryOutputPublicationFailureInput,
  IReleaseDiscoveryOutputClaimInput,
  ISaveDiscoveryOutputInput,
} from '../../ports/outbound/discovery-output-repository.port.js';
import {
  IFindLeadsForBackfillInput,
  ILeadBackfillPage,
  ILeadRepositoryPort,
  ILeadUpsertResult,
} from '../../ports/outbound/lead-repository.port.js';
import { DiscoveryBackfillService } from './discovery-backfill.service.js';
import { IDiscoveryCampaignConfiguration } from './discovery-campaign-configuration.js';

const CURRENT_TIME = new Date('2026-09-02T12:00:00.000Z');
const CAMPAIGN_CONFIGURATION: IDiscoveryCampaignConfiguration = {
  campaignId: 'campaign-a',
  configurationHash: 'configuration-hash',
  limits: { dailyProviderItemLimit: 100, maxProviderItemsPerRun: 50 },
  scopes: [],
  searchQueries: ['lead'],
  source: { actorId: 'actor', kind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS },
  version: 1,
};

describe('DiscoveryBackfillService', () => {
  it('requires the explicitly configured campaign and confirmation', async () => {
    const harness = createHarness([createLead('lead-1')]);

    await expect(harness.service.runBackfill({
      ...createInput(),
      campaignId: 'other-campaign',
    })).rejects.toThrow('not the configured Discovery campaign');
    await expect(harness.service.runBackfill({
      ...createInput(),
      confirmed: false,
    })).rejects.toThrow('requires explicit confirmation');
  });

  it('previews a deterministic paginated selection without creating outputs', async () => {
    const harness = createHarness([
      createLead('lead-3'),
      createLead('lead-1'),
      createLead('lead-2'),
    ]);
    const result = await harness.service.runBackfill({
      ...createInput(),
      dryRun: true,
      maximumLeadCount: 2,
    });

    expect(result).toEqual({
      existingOutputCount: 0,
      insertedOutputCount: 0,
      runId: 'run-1',
      selectedLeadCount: 2,
    });
    expect(harness.outputRepository.outputs).toHaveLength(0);
    expect(harness.leadRepository.requests).toEqual([
      {
        limit: 2,
        sourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
      },
    ]);
    expect(harness.runRepository.get('run-1')?.status).toBe(
      DISCOVERY_BACKFILL_RUN_STATUS.COMPLETED,
    );
  });

  it('keeps repeat runs and existing outputs idempotent', async () => {
    const harness = createHarness([createLead('lead-2'), createLead('lead-1')]);
    const firstResult = await harness.service.runBackfill(createInput());
    const repeatResult = await harness.service.runBackfill({
      ...createInput(),
      runId: 'run-2',
    });
    const sameRunResult = await harness.service.runBackfill(createInput());

    expect(firstResult.insertedOutputCount).toBe(2);
    expect(repeatResult).toEqual({
      existingOutputCount: 2,
      insertedOutputCount: 0,
      runId: 'run-2',
      selectedLeadCount: 2,
    });
    expect(sameRunResult).toEqual(firstResult);
    expect(harness.outputRepository.outputs).toHaveLength(2);
    expect(harness.outputRepository.outputs.map((output) => output.payload.origin)).toEqual([
      'backfill',
      'backfill',
    ]);
  });

  it('resumes a failed run through the same unique outbox identities', async () => {
    const harness = createHarness([createLead('lead-1'), createLead('lead-2')]);

    harness.outputRepository.failureOnSaveCount = 2;

    await expect(harness.service.runBackfill(createInput())).rejects.toThrow('output failure');
    expect(harness.runRepository.get('run-1')?.status).toBe(
      DISCOVERY_BACKFILL_RUN_STATUS.FAILED,
    );
    expect(harness.outputRepository.outputs).toHaveLength(1);

    harness.outputRepository.failureOnSaveCount = undefined;
    const result = await harness.service.runBackfill(createInput());

    expect(result).toEqual({
      existingOutputCount: 1,
      insertedOutputCount: 1,
      runId: 'run-1',
      selectedLeadCount: 2,
    });
    expect(harness.outputRepository.outputs).toHaveLength(2);

    await expect(harness.service.runBackfill({
      ...createInput(),
      maximumLeadCount: 1,
    })).rejects.toThrow('does not match the requested selection');
    expect(harness.runRepository.get('run-1')?.status).toBe(
      DISCOVERY_BACKFILL_RUN_STATUS.COMPLETED,
    );
  });
});

function createHarness(leads: readonly Lead[]): ITestHarness {
  const clock = new FakeClock();
  const runRepository = new FakeBackfillRunRepository();
  const outputRepository = new FakeDiscoveryOutputRepository();
  const leadRepository = new FakeLeadRepository(leads);

  return {
    leadRepository,
    outputRepository,
    runRepository,
    service: new DiscoveryBackfillService(
      new FakeCampaignConfiguration(),
      clock,
      runRepository,
      outputRepository,
      leadRepository,
    ),
  };
}

function createInput(): IRunDiscoveryBackfillInput {
  return {
    campaignId: CAMPAIGN_CONFIGURATION.campaignId,
    confirmed: true,
    correlationId: 'correlation-1',
    dryRun: false,
    maximumLeadCount: 2,
    qualificationCatalogRevision: '2026-09-02-r1',
    runId: 'run-1',
    sourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
  };
}

function createLead(leadId: string): Lead {
  return new Lead(
    CURRENT_TIME,
    { name: `Name ${leadId}` },
    leadId,
    new LeadSourceIdentity(`external-${leadId}`, DISCOVERY_SOURCE_KIND.GOOGLE_MAPS),
    CURRENT_TIME,
  );
}

interface ITestHarness {
  readonly leadRepository: FakeLeadRepository;
  readonly outputRepository: FakeDiscoveryOutputRepository;
  readonly runRepository: FakeBackfillRunRepository;
  readonly service: DiscoveryBackfillService;
}

class FakeCampaignConfiguration implements IDiscoveryCampaignConfigurationPort {
  public getCampaignConfiguration(): IDiscoveryCampaignConfiguration {
    return CAMPAIGN_CONFIGURATION;
  }
}

class FakeClock implements IClockPort {
  private nextTime = CURRENT_TIME.getTime();

  public getCurrentTime(): Date {
    const currentTime = new Date(this.nextTime);

    this.nextTime += 1_000;

    return currentTime;
  }
}

class FakeBackfillRunRepository implements IDiscoveryBackfillRunRepositoryPort {
  private readonly runs = new Map<string, IDiscoveryBackfillRun>();

  public async completeBackfillRun(input: ICompleteDiscoveryBackfillRunInput): Promise<void> {
    const run = this.requireRun(input.runId);

    this.runs.set(input.runId, {
      ...run,
      completedAt: input.completedAt,
      status: DISCOVERY_BACKFILL_RUN_STATUS.COMPLETED,
      totalExistingOutputCount: input.totalExistingOutputCount,
      totalInsertedOutputCount: input.totalInsertedOutputCount,
      totalSelectedLeadCount: input.totalSelectedLeadCount,
      updatedAt: input.completedAt,
    });
  }

  public async failBackfillRun(input: IFailDiscoveryBackfillRunInput): Promise<void> {
    const run = this.requireRun(input.runId);

    this.runs.set(input.runId, {
      ...run,
      failureMessage: input.failureMessage,
      status: DISCOVERY_BACKFILL_RUN_STATUS.FAILED,
      updatedAt: input.failedAt,
    });
  }

  public async findBackfillRun(runId: string): Promise<IDiscoveryBackfillRun | undefined> {
    return this.runs.get(runId);
  }

  public get(runId: string): IDiscoveryBackfillRun | undefined {
    return this.runs.get(runId);
  }

  public async startBackfillRun(
    input: IStartDiscoveryBackfillRunInput,
  ): Promise<IDiscoveryBackfillRun> {
    const existing = this.runs.get(input.runId);
    const run: IDiscoveryBackfillRun = existing === undefined
      ? {
        ...input,
        status: DISCOVERY_BACKFILL_RUN_STATUS.RUNNING,
        totalExistingOutputCount: 0,
        totalInsertedOutputCount: 0,
        totalSelectedLeadCount: 0,
        updatedAt: input.createdAt,
      }
      : {
        ...existing,
        status: DISCOVERY_BACKFILL_RUN_STATUS.RUNNING,
        updatedAt: input.createdAt,
      };

    this.runs.set(input.runId, run);

    return run;
  }

  private requireRun(runId: string): IDiscoveryBackfillRun {
    const run = this.runs.get(runId);

    if (run === undefined) {
      throw new Error(`backfill run ${runId} does not exist`);
    }

    return run;
  }
}

class FakeDiscoveryOutputRepository implements IDiscoveryOutputRepositoryPort {
  public failureOnSaveCount: number | undefined;
  public readonly outputs: ISaveDiscoveryOutputInput[] = [];
  private saveCount = 0;

  public async claimPendingDiscoveryOutputs(
    input: IClaimPendingDiscoveryOutputsInput,
  ): Promise<readonly IClaimedDiscoveryOutput[]> {
    void input;

    return [];
  }

  public async confirmDiscoveryOutputPublication(
    input: IConfirmDiscoveryOutputPublicationInput,
  ): Promise<boolean> {
    void input;

    return true;
  }

  public async recordDiscoveryOutputPublicationFailure(
    input: IRecordDiscoveryOutputPublicationFailureInput,
  ): Promise<boolean> {
    void input;

    return true;
  }

  public async releaseDiscoveryOutputClaim(
    input: IReleaseDiscoveryOutputClaimInput,
  ): Promise<boolean> {
    void input;

    return true;
  }

  public async saveDiscoveryOutput(
    input: ISaveDiscoveryOutputInput,
  ): Promise<DISCOVERY_OUTPUT_SAVE_OUTCOME> {
    this.saveCount += 1;

    if (this.failureOnSaveCount === this.saveCount) {
      throw new Error('output failure');
    }
    if (this.outputs.some((output) => output.leadId === input.leadId)) {
      return DISCOVERY_OUTPUT_SAVE_OUTCOME.EXISTING;
    }

    this.outputs.push(input);

    return DISCOVERY_OUTPUT_SAVE_OUTCOME.INSERTED;
  }
}

class FakeLeadRepository implements ILeadRepositoryPort {
  public readonly requests: IFindLeadsForBackfillInput[] = [];

  public constructor(private readonly leads: readonly Lead[]) {}

  public async findLeadsForBackfill(
    input: IFindLeadsForBackfillInput,
  ): Promise<ILeadBackfillPage> {
    this.requests.push(input);
    const orderedLeads = [...this.leads].filter((lead) =>
      input.leadIdPrefix === undefined
      || lead.leadId.startsWith(input.leadIdPrefix)).sort((left, right) =>
      left.leadId.localeCompare(right.leadId));
    const afterLeadId = input.afterLeadId;

    if (afterLeadId === undefined) {
      return { leads: orderedLeads.slice(0, input.limit) };
    }

    const eligibleLeads = orderedLeads.filter(
      (lead) => lead.leadId > afterLeadId,
    );

    return { leads: eligibleLeads.slice(0, input.limit) };
  }

  public async upsertLead(lead: Lead): Promise<ILeadUpsertResult> {
    void lead;

    throw new Error('not used by backfill');
  }
}
