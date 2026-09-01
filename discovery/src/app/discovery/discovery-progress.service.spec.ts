import {
  DISCOVERY_SCOPE_STATUS,
  DISCOVERY_SOURCE_KIND,
  DiscoveryCampaignReference,
  DiscoveryScopeProgress,
  IProviderRunReference,
  Lead,
  PROVIDER_RUN_STATUS,
} from '../../domain/discovery/discovery-model.js';
import { IClockPort } from '../../ports/outbound/clock.port.js';
import {
  IDiscoveryCampaignConfigurationPort,
} from '../../ports/outbound/discovery-campaign-configuration.port.js';
import {
  IDiscoveryOutputRepositoryPort,
  ISaveDiscoveryOutputInput,
} from '../../ports/outbound/discovery-output-repository.port.js';
import {
  IDiscoveryProviderPort,
  IGetProviderRunStatusInput,
  IProviderLeadCandidate,
  IProviderResultPage,
  IReadProviderResultsInput,
  IStartProviderRunInput,
} from '../../ports/outbound/discovery-provider.port.js';
import {
  IClaimNextActiveScopeInput,
  IClaimNextEligibleScopeInput,
  IDiscoveryStateRepositoryPort,
  IReleaseScopeClaimInput,
  ISynchronizeConfiguredScopesInput,
} from '../../ports/outbound/discovery-state-repository.port.js';
import {
  ILeadRepositoryPort,
  ILeadUpsertResult,
  LEAD_UPSERT_OUTCOME,
} from '../../ports/outbound/lead-repository.port.js';
import {
  IProviderQuotaRepositoryPort,
  IProviderQuotaReservation,
  IReserveDailyQuotaInput,
} from '../../ports/outbound/provider-quota-repository.port.js';
import {
  IDiscoveryCampaignConfiguration,
  IDiscoveryScopeConfiguration,
} from './discovery-campaign-configuration.js';
import {
  DISCOVERY_WORK_OUTCOME,
  DiscoveryProgressService,
} from './discovery-progress.service.js';

const CAMPAIGN_CONFIGURATION: IDiscoveryCampaignConfiguration = {
  campaignId: 'campaign-a',
  configurationHash: 'config-hash',
  limits: {
    dailyProviderItemLimit: 100,
    maxProviderItemsPerRun: 50,
  },
  scopes: [
    { id: 'GB', label: 'United Kingdom', priority: 1 },
    { id: 'IE', label: 'Ireland', priority: 2 },
  ],
  searchQueries: ['independent hotel'],
  source: {
    actorId: 'actor',
    kind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
  },
  version: 1,
};

describe('DiscoveryProgressService', () => {
  it('persists a quota reservation and provider run before returning', async () => {
    const harness = createHarness();
    const result = await harness.service.advanceDiscoveryWork(createInput());
    const scope = await harness.state.findScopeProgress('campaign-a', 'GB');

    expect(result).toEqual({
      outcome: DISCOVERY_WORK_OUTCOME.PROVIDER_RUN_STARTED,
      reservedItemCount: 50,
      scopeId: 'GB',
    });
    expect(scope?.providerRun?.providerRunId).toBe('run-1');
    expect(scope?.reservedProviderItemCount).toBe(50);
    expect(scope?.claimedBy).toBeUndefined();
  });

  it('revisits a persisted active run and waits while the provider is pending', async () => {
    const harness = createHarness({
      runStatuses: [PROVIDER_RUN_STATUS.PENDING],
    });

    await harness.service.advanceDiscoveryWork(createInput());
    const result = await harness.service.advanceDiscoveryWork(createInput());

    expect(result).toEqual({
      outcome: DISCOVERY_WORK_OUTCOME.PROVIDER_RUN_PENDING,
      scopeId: 'GB',
    });
    expect(harness.provider.statusRequests).toBe(1);
  });

  it('imports a completed page idempotently and emits output only for new identities', async () => {
    const candidate: IProviderLeadCandidate = {
      externalId: 'provider-place-1',
      name: 'Example Lead',
    };
    const harness = createHarness({
      pages: [
        {
          items: [candidate, candidate],
          nextOffset: null,
        },
      ],
      runStatuses: [PROVIDER_RUN_STATUS.SUCCEEDED],
    });

    await harness.service.advanceDiscoveryWork(createInput());
    const result = await harness.service.advanceDiscoveryWork(createInput());
    const scope = await harness.state.findScopeProgress('campaign-a', 'GB');

    expect(result).toEqual({
      outcome: DISCOVERY_WORK_OUTCOME.IMPORT_COMPLETED,
      scopeId: 'GB',
    });
    expect(scope?.status).toBe(DISCOVERY_SCOPE_STATUS.DONE);
    expect(harness.leads.leads).toHaveLength(1);
    expect(harness.outputs.outputs).toHaveLength(1);
    expect(harness.provider.readRequests).toBe(1);
  });

  it('continues from durable page progress after reconstruction', async () => {
    const harness = createHarness({
      pages: [
        {
          items: [{ externalId: 'provider-place-1', name: 'First' }],
          nextOffset: 1,
        },
        {
          items: [{ externalId: 'provider-place-2', name: 'Second' }],
          nextOffset: null,
        },
      ],
      runStatuses: [PROVIDER_RUN_STATUS.SUCCEEDED],
    });

    await harness.service.advanceDiscoveryWork(createInput());
    const firstImport = await harness.service.advanceDiscoveryWork(createInput());
    const restartedService = createService(harness);
    const secondImport = await restartedService.advanceDiscoveryWork(createInput());
    const scope = await harness.state.findScopeProgress('campaign-a', 'GB');

    expect(firstImport.outcome).toBe(DISCOVERY_WORK_OUTCOME.IMPORT_PROGRESS_SAVED);
    expect(secondImport.outcome).toBe(DISCOVERY_WORK_OUTCOME.IMPORT_COMPLETED);
    expect(scope?.importProgress?.nextItemOffset).toBe(2);
    expect(harness.outputs.outputs).toHaveLength(2);
  });

  it('moves to the next configured scope after finishing the current one', async () => {
    const harness = createHarness({
      pages: [{ items: [], nextOffset: null }],
      runStatuses: [PROVIDER_RUN_STATUS.SUCCEEDED],
    });

    await harness.service.advanceDiscoveryWork(createInput());
    await harness.service.advanceDiscoveryWork(createInput());
    const nextResult = await harness.service.advanceDiscoveryWork(createInput());

    expect(nextResult).toEqual({
      outcome: DISCOVERY_WORK_OUTCOME.PROVIDER_RUN_STARTED,
      reservedItemCount: 50,
      scopeId: 'IE',
    });
  });

  it('does not create a second output when a later scope returns a known identity', async () => {
    const knownCandidate: IProviderLeadCandidate = {
      externalId: 'provider-place-1',
      name: 'Known Lead',
    };
    const harness = createHarness({
      pages: [
        { items: [knownCandidate], nextOffset: null },
        { items: [knownCandidate], nextOffset: null },
      ],
      runStatuses: [
        PROVIDER_RUN_STATUS.SUCCEEDED,
        PROVIDER_RUN_STATUS.SUCCEEDED,
      ],
    });

    await harness.service.advanceDiscoveryWork(createInput());
    await harness.service.advanceDiscoveryWork(createInput());
    await harness.service.advanceDiscoveryWork(createInput());
    await harness.service.advanceDiscoveryWork(createInput());

    expect(harness.leads.leads).toHaveLength(1);
    expect(harness.outputs.outputs).toHaveLength(1);
  });

  it('does not start a provider run when the daily quota is unavailable', async () => {
    const harness = createHarness({ quotaAvailable: false });
    const result = await harness.service.advanceDiscoveryWork(createInput());

    expect(result.outcome).toBe(DISCOVERY_WORK_OUTCOME.BUDGET_EXHAUSTED);
    expect(harness.provider.startRequests).toBe(0);
  });
});

function createHarness(options: ITestHarnessOptions = {}): ITestHarness {
  const configuration: IDiscoveryCampaignConfiguration = {
    ...CAMPAIGN_CONFIGURATION,
    scopes: options.scopes ?? CAMPAIGN_CONFIGURATION.scopes,
  };
  const campaignConfiguration = new FakeCampaignConfiguration(configuration);
  const clock = new FakeClock(new Date('2026-09-01T00:00:00.000Z'));
  const outputs = new FakeDiscoveryOutputRepository();
  const provider = new FakeDiscoveryProvider(
    options.runStatuses ?? [PROVIDER_RUN_STATUS.SUCCEEDED],
    options.pages ?? [{ items: [], nextOffset: null }],
  );
  const quota = new FakeProviderQuotaRepository(options.quotaAvailable ?? true);
  const leads = new FakeLeadRepository();
  const state = new FakeDiscoveryStateRepository();

  return {
    campaignConfiguration,
    clock,
    leads,
    outputs,
    provider,
    quota,
    service: new DiscoveryProgressService(
      campaignConfiguration,
      clock,
      outputs,
      provider,
      leads,
      state,
      quota,
    ),
    state,
  };
}

function createInput() {
  return { correlationId: 'correlation-a', workerId: 'worker-a' };
}

function createService(harness: ITestHarness): DiscoveryProgressService {
  return new DiscoveryProgressService(
    harness.campaignConfiguration,
    harness.clock,
    harness.outputs,
    harness.provider,
    harness.leads,
    harness.state,
    harness.quota,
  );
}

interface ITestHarness {
  readonly campaignConfiguration: FakeCampaignConfiguration;
  readonly clock: FakeClock;
  readonly leads: FakeLeadRepository;
  readonly outputs: FakeDiscoveryOutputRepository;
  readonly provider: FakeDiscoveryProvider;
  readonly quota: FakeProviderQuotaRepository;
  readonly service: DiscoveryProgressService;
  readonly state: FakeDiscoveryStateRepository;
}

interface ITestHarnessOptions {
  readonly pages?: readonly IProviderResultPage[];
  readonly quotaAvailable?: boolean;
  readonly runStatuses?: readonly PROVIDER_RUN_STATUS[];
  readonly scopes?: readonly IDiscoveryScopeConfiguration[];
}

class FakeCampaignConfiguration implements IDiscoveryCampaignConfigurationPort {
  public constructor(private readonly configuration: IDiscoveryCampaignConfiguration) {}

  public getCampaignConfiguration(): IDiscoveryCampaignConfiguration {
    return this.configuration;
  }
}

class FakeClock implements IClockPort {
  public constructor(private readonly currentTime: Date) {}

  public getCurrentTime(): Date {
    return this.currentTime;
  }
}

class FakeDiscoveryOutputRepository implements IDiscoveryOutputRepositoryPort {
  public readonly outputs: ISaveDiscoveryOutputInput[] = [];

  public async saveDiscoveryOutput(input: ISaveDiscoveryOutputInput): Promise<void> {
    if (this.outputs.some((output) => output.outputId === input.outputId)) {
      return;
    }

    this.outputs.push(input);
  }
}

class FakeDiscoveryProvider implements IDiscoveryProviderPort {
  public readRequests = 0;
  public startRequests = 0;
  public statusRequests = 0;
  private pageIndex = 0;
  private statusIndex = 0;

  public constructor(
    private readonly runStatuses: readonly PROVIDER_RUN_STATUS[],
    private readonly pages: readonly IProviderResultPage[],
  ) {}

  public async getRunStatus(
    input: IGetProviderRunStatusInput,
  ): Promise<IProviderRunReference> {
    this.statusRequests += 1;

    return {
      datasetReference: 'dataset-1',
      providerRunId: input.providerRunId,
      status: this.nextRunStatus(),
    };
  }

  public async readProviderResults(
    input: IReadProviderResultsInput,
  ): Promise<IProviderResultPage> {
    this.readRequests += 1;

    if (input.datasetReference !== 'dataset-1') {
      throw new Error('unexpected dataset reference');
    }

    const page = this.pages[this.pageIndex];

    this.pageIndex += 1;

    if (page === undefined) {
      throw new Error('unexpected provider result page');
    }

    return page;
  }

  public async startProviderRun(
    input: IStartProviderRunInput,
  ): Promise<IProviderRunReference> {
    this.startRequests += 1;

    if (input.maximumItemCount > 50) {
      throw new Error('requested provider cap is too high');
    }

    return {
      datasetReference: 'dataset-1',
      providerRunId: `run-${this.startRequests}`,
      status: PROVIDER_RUN_STATUS.PENDING,
    };
  }

  private nextRunStatus(): PROVIDER_RUN_STATUS {
    const status = this.runStatuses[this.statusIndex] ?? PROVIDER_RUN_STATUS.SUCCEEDED;

    this.statusIndex += 1;

    return status;
  }
}

class FakeDiscoveryStateRepository implements IDiscoveryStateRepositoryPort {
  private readonly scopes = new Map<string, DiscoveryScopeProgress>();

  public async claimNextActiveScope(
    input: IClaimNextActiveScopeInput,
  ): Promise<DiscoveryScopeProgress | null> {
    const scope = [...this.scopes.values()]
      .filter(
        (candidate) =>
          candidate.campaign.campaignId === input.campaignId
          && (candidate.status === DISCOVERY_SCOPE_STATUS.IMPORTING
            || candidate.status === DISCOVERY_SCOPE_STATUS.RUNNING)
          && (candidate.claimedBy === undefined
            || (candidate.claimedAt !== undefined
              && candidate.claimedAt <= input.staleClaimBefore)),
      )
      .sort((left, right) => left.priority - right.priority)[0];

    if (scope === undefined) {
      return null;
    }

    const claimedScope = new DiscoveryScopeProgress(
      scope.attemptCount,
      scope.campaign,
      scope.priority,
      input.claimedAt,
      input.workerId,
      scope.completedAt,
      scope.failure,
      scope.importProgress,
      scope.reservedProviderItemCount,
      scope.providerRun,
      scope.scopeId,
      scope.status,
      input.claimedAt,
    );

    this.scopes.set(scope.scopeId, claimedScope);

    return claimedScope;
  }

  public async claimNextEligibleScope(
    input: IClaimNextEligibleScopeInput,
  ): Promise<DiscoveryScopeProgress | null> {
    const scope = [...this.scopes.values()]
      .filter(
        (candidate) =>
          candidate.campaign.campaignId === input.campaignId
          && candidate.status === DISCOVERY_SCOPE_STATUS.PENDING,
      )
      .sort((left, right) => left.priority - right.priority)[0];

    if (scope === undefined) {
      return null;
    }

    const claimedScope = new DiscoveryScopeProgress(
      scope.attemptCount + 1,
      scope.campaign,
      scope.priority,
      input.claimedAt,
      input.workerId,
      scope.completedAt,
      scope.failure,
      scope.importProgress,
      scope.reservedProviderItemCount,
      scope.providerRun,
      scope.scopeId,
      DISCOVERY_SCOPE_STATUS.RUNNING,
      input.claimedAt,
    );

    this.scopes.set(scope.scopeId, claimedScope);

    return claimedScope;
  }

  public async findScopeProgress(
    campaignId: string,
    scopeId: string,
  ): Promise<DiscoveryScopeProgress | null> {
    const scope = this.scopes.get(scopeId);

    return scope?.campaign.campaignId === campaignId ? scope : null;
  }

  public async releaseScopeClaim(input: IReleaseScopeClaimInput): Promise<boolean> {
    const scope = await this.findScopeProgress(input.campaignId, input.scopeId);

    if (scope === null || scope.claimedBy !== input.workerId) {
      return false;
    }

    this.scopes.set(
      scope.scopeId,
      new DiscoveryScopeProgress(
        scope.attemptCount,
        scope.campaign,
        scope.priority,
        undefined,
        undefined,
        scope.completedAt,
        scope.failure,
        scope.importProgress,
        scope.reservedProviderItemCount,
        scope.providerRun,
        scope.scopeId,
        DISCOVERY_SCOPE_STATUS.PENDING,
        input.releasedAt,
      ),
    );

    return true;
  }

  public async saveScopeProgress(scope: DiscoveryScopeProgress): Promise<void> {
    this.scopes.set(scope.scopeId, scope);
  }

  public async synchronizeConfiguredScopes(
    input: ISynchronizeConfiguredScopesInput,
  ): Promise<void> {
    for (const configuredScope of input.scopes) {
      if (this.scopes.has(configuredScope.scopeId)) {
        continue;
      }

      this.scopes.set(
        configuredScope.scopeId,
        new DiscoveryScopeProgress(
          0,
          new DiscoveryCampaignReference(input.campaignId),
          configuredScope.priority,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          configuredScope.scopeId,
          DISCOVERY_SCOPE_STATUS.PENDING,
          input.synchronizedAt,
        ),
      );
    }
  }
}

class FakeLeadRepository implements ILeadRepositoryPort {
  public readonly leads: Lead[] = [];

  public async upsertLead(lead: Lead): Promise<ILeadUpsertResult> {
    const existingLead = this.leads.find(
      (candidate) =>
        candidate.sourceIdentity.externalId === lead.sourceIdentity.externalId
        && candidate.sourceIdentity.sourceKind === lead.sourceIdentity.sourceKind,
    );

    if (existingLead !== undefined) {
      return {
        leadId: existingLead.leadId,
        outcome: LEAD_UPSERT_OUTCOME.EXISTING,
      };
    }

    this.leads.push(lead);

    return { leadId: lead.leadId, outcome: LEAD_UPSERT_OUTCOME.INSERTED };
  }
}

class FakeProviderQuotaRepository implements IProviderQuotaRepositoryPort {
  public constructor(private readonly isAvailable: boolean) {}

  public async reserveDailyQuota(
    input: IReserveDailyQuotaInput,
  ): Promise<IProviderQuotaReservation | null> {
    return this.isAvailable
      ? {
          campaignId: input.campaignId,
          quotaDay: input.quotaDay,
          reservedItemCount: input.requestedItemCount,
        }
      : null;
  }
}
