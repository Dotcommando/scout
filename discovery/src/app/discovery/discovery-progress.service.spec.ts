import { DiscoveryWorker } from '../../adapters/inbound/scheduler/discovery-worker.js';
import {
  DISCOVERY_SCOPE_STATUS,
  DISCOVERY_SOURCE_KIND,
  DiscoveryCampaignReference,
  DiscoveryScopeProgress,
} from '../../domain/discovery/discovery-model.js';
import { IClockPort } from '../../ports/outbound/clock.port.js';
import {
  IDiscoveryCampaignConfigurationPort,
} from '../../ports/outbound/discovery-campaign-configuration.port.js';
import {
  IClaimNextEligibleScopeInput,
  IDiscoveryStateRepositoryPort,
  IReleaseScopeClaimInput,
  ISynchronizeConfiguredScopesInput,
} from '../../ports/outbound/discovery-state-repository.port.js';
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
    {
      id: 'GB',
      label: 'United Kingdom',
      priority: 1,
    },
    {
      id: 'IE',
      label: 'Ireland',
      priority: 2,
    },
  ],
  searchQueries: ['independent hotel'],
  source: {
    actorId: 'actor',
    kind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
  },
  version: 1,
};

describe('DiscoveryProgressService', () => {
  it('selects the first configured scope deterministically', async () => {
    const harness = createHarness();
    const result = await harness.service.advanceDiscoveryWork(createInput());

    expect(result).toEqual({
      outcome: DISCOVERY_WORK_OUTCOME.SCOPE_CLAIMED,
      reservedItemCount: 50,
      scopeId: 'GB',
    });
  });

  it('prevents overlapping worker ticks from claiming the same scope twice', async () => {
    const harness = createHarness({
      scopes: [CAMPAIGN_CONFIGURATION.scopes[0]],
    });
    const worker = new DiscoveryWorker(harness.service);
    const outcomes = await Promise.all([worker.triggerWork(), worker.triggerWork()]);

    expect(outcomes).toContain(DISCOVERY_WORK_OUTCOME.SCOPE_CLAIMED);
    expect(outcomes).toContain(null);
  });

  it('does not restart completed work and advances to the next scope', async () => {
    const harness = createHarness();
    const firstResult = await harness.service.advanceDiscoveryWork(createInput());
    const firstScope = await harness.state.findScopeProgress('campaign-a', 'GB');

    if (firstScope === null) {
      throw new Error('GB should have been claimed');
    }

    await harness.state.saveScopeProgress(
      firstScope
        .startImport(harness.clock.getCurrentTime())
        .complete(harness.clock.getCurrentTime()),
    );

    const secondResult = await harness.service.advanceDiscoveryWork(createInput());

    expect(firstResult.scopeId).toBe('GB');
    expect(secondResult.scopeId).toBe('IE');
  });

  it('becomes idle once all persisted scopes are complete', async () => {
    const harness = createHarness();

    await harness.state.synchronizeConfiguredScopes({
      campaignId: 'campaign-a',
      configurationHash: 'config-hash',
      scopes: CAMPAIGN_CONFIGURATION.scopes.map((scope) => ({
        priority: scope.priority,
        scopeId: scope.id,
      })),
      synchronizedAt: harness.clock.getCurrentTime(),
    });

    for (const scopeId of ['GB', 'IE']) {
      const scope = await harness.state.claimNextEligibleScope({
        campaignId: 'campaign-a',
        claimedAt: harness.clock.getCurrentTime(),
        workerId: 'worker-a',
      });

      if (scope?.scopeId !== scopeId) {
        throw new Error('expected deterministic pending scope');
      }

      await harness.state.saveScopeProgress(
        scope
          .startImport(harness.clock.getCurrentTime())
          .complete(harness.clock.getCurrentTime()),
      );
    }

    const result = await harness.service.advanceDiscoveryWork(createInput());

    expect(result.outcome).toBe(DISCOVERY_WORK_OUTCOME.IDLE);
  });

  it('releases the scope and becomes budget-exhausted without completing it', async () => {
    const harness = createHarness({
      quotaAvailable: false,
      scopes: [CAMPAIGN_CONFIGURATION.scopes[0]],
    });
    const result = await harness.service.advanceDiscoveryWork(createInput());
    const scope = await harness.state.findScopeProgress('campaign-a', 'GB');

    expect(result.outcome).toBe(DISCOVERY_WORK_OUTCOME.BUDGET_EXHAUSTED);
    expect(scope?.status).toBe(DISCOVERY_SCOPE_STATUS.PENDING);
  });

  it('makes released work eligible again in the next UTC quota window', async () => {
    const harness = createHarness({
      quotaAvailable: false,
      scopes: [CAMPAIGN_CONFIGURATION.scopes[0]],
    });

    await harness.service.advanceDiscoveryWork(createInput());
    harness.quota.isAvailable = true;
    harness.clock.currentTime = new Date('2026-09-02T00:00:00.000Z');

    const result = await harness.service.advanceDiscoveryWork(createInput());

    expect(result).toEqual({
      outcome: DISCOVERY_WORK_OUTCOME.SCOPE_CLAIMED,
      reservedItemCount: 50,
      scopeId: 'GB',
    });
  });

  it('enforces active, importing, completed, and terminal-failure transitions', () => {
    const activeScope = createActiveScope();
    const importingScope = activeScope.startImport(
      new Date('2026-09-01T01:00:00.000Z'),
    );
    const completedScope = importingScope.complete(
      new Date('2026-09-01T02:00:00.000Z'),
    );
    const failedScope = activeScope.fail(
      {
        message: 'provider failed permanently',
        occurredAt: new Date('2026-09-01T03:00:00.000Z'),
      },
      new Date('2026-09-01T03:00:00.000Z'),
    );

    expect(importingScope.status).toBe(DISCOVERY_SCOPE_STATUS.IMPORTING);
    expect(completedScope.status).toBe(DISCOVERY_SCOPE_STATUS.DONE);
    expect(failedScope.status).toBe(DISCOVERY_SCOPE_STATUS.FAILED);
    expect(() => activeScope.complete(new Date())).toThrow();
  });
});

function createHarness(options: ITestHarnessOptions = {}): ITestHarness {
  const configuration: IDiscoveryCampaignConfiguration = {
    ...CAMPAIGN_CONFIGURATION,
    scopes: options.scopes ?? CAMPAIGN_CONFIGURATION.scopes,
  };
  const campaignConfiguration = new FakeCampaignConfiguration(configuration);
  const clock = new FakeClock(new Date('2026-09-01T00:00:00.000Z'));
  const state = new FakeDiscoveryStateRepository();
  const quota = new FakeProviderQuotaRepository(options.quotaAvailable ?? true);

  return {
    clock,
    quota,
    service: new DiscoveryProgressService(
      campaignConfiguration,
      clock,
      state,
      quota,
    ),
    state,
  };
}

function createInput() {
  return {
    correlationId: 'correlation-a',
    workerId: 'worker-a',
  };
}

function createActiveScope(): DiscoveryScopeProgress {
  return new DiscoveryScopeProgress(
    1,
    new DiscoveryCampaignReference('campaign-a'),
    1,
    new Date('2026-09-01T00:00:00.000Z'),
    'worker-a',
    undefined,
    undefined,
    undefined,
    undefined,
    'GB',
    DISCOVERY_SCOPE_STATUS.RUNNING,
    new Date('2026-09-01T00:00:00.000Z'),
  );
}

interface ITestHarness {
  readonly clock: FakeClock;
  readonly quota: FakeProviderQuotaRepository;
  readonly service: DiscoveryProgressService;
  readonly state: FakeDiscoveryStateRepository;
}

interface ITestHarnessOptions {
  readonly quotaAvailable?: boolean;
  readonly scopes?: readonly IDiscoveryScopeConfiguration[];
}

class FakeCampaignConfiguration implements IDiscoveryCampaignConfigurationPort {
  public constructor(private readonly configuration: IDiscoveryCampaignConfiguration) {}

  public getCampaignConfiguration(): IDiscoveryCampaignConfiguration {
    return this.configuration;
  }
}

class FakeClock implements IClockPort {
  public constructor(public currentTime: Date) {}

  public getCurrentTime(): Date {
    return this.currentTime;
  }
}

class FakeDiscoveryStateRepository implements IDiscoveryStateRepositoryPort {
  private readonly scopes = new Map<string, DiscoveryScopeProgress>();

  public async claimNextEligibleScope(
    input: IClaimNextEligibleScopeInput,
  ): Promise<DiscoveryScopeProgress | null> {
    const scope = [...this.scopes.values()]
      .filter(
        (candidate) =>
          candidate.campaign.campaignId === input.campaignId
          && candidate.status === DISCOVERY_SCOPE_STATUS.PENDING,
      )
      .sort(
        (left, right) =>
          left.priority - right.priority
          || left.scopeId.localeCompare(right.scopeId),
      )[0];

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

    if (
      scope === null
      || scope.status !== DISCOVERY_SCOPE_STATUS.RUNNING
      || scope.claimedBy !== input.workerId
    ) {
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
      const existingScope = this.scopes.get(configuredScope.scopeId);

      if (existingScope !== undefined) {
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
          configuredScope.scopeId,
          DISCOVERY_SCOPE_STATUS.PENDING,
          input.synchronizedAt,
        ),
      );
    }
  }
}

class FakeProviderQuotaRepository implements IProviderQuotaRepositoryPort {
  public constructor(public isAvailable: boolean) {}

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
