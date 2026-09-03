import {
  IDiscoveryCampaignConfiguration,
} from '../../../app/discovery/discovery-campaign-configuration.js';
import { DISCOVERY_SOURCE_KIND } from '../../../domain/discovery/discovery-model.js';
import { IClockPort } from '../../../ports/outbound/clock.port.js';
import { IDiscoveryCampaignConfigurationPort } from '../../../ports/outbound/discovery-campaign-configuration.port.js';
import {
  DISCOVERY_DAILY_START_DECISION,
  DISCOVERY_START_TRIGGER_KIND,
  IDiscoveryDailyStartClaimInput,
  IDiscoveryDailyStartClaimResult,
  IDiscoveryDailyStartRepositoryPort,
} from '../../../ports/outbound/discovery-daily-start-repository.port.js';
import { DiscoveryStartupCoordinator } from './discovery-startup-coordinator.js';

class FixedClock implements IClockPort {
  public getCurrentTime(): Date {
    return new Date('2026-09-03T22:30:00.000Z');
  }
}

class FixedCampaignConfiguration implements IDiscoveryCampaignConfigurationPort {
  public getCampaignConfiguration(): IDiscoveryCampaignConfiguration {
    return {
      campaignId: 'campaign-1',
      configurationHash: 'hash-1',
      limits: { dailyProviderItemLimit: 25, maxProviderItemsPerRun: 25 },
      scopes: [{ id: 'MD', label: 'Moldova', priority: 1 }],
      searchQueries: ['lead'],
      source: { actorId: 'google-maps-search', kind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS },
      version: 1,
    };
  }
}

class RecordingDailyStartRepository implements IDiscoveryDailyStartRepositoryPort {
  public readonly claims: IDiscoveryDailyStartClaimInput[] = [];

  public constructor(private readonly decision: DISCOVERY_DAILY_START_DECISION) {}

  public async claimDailyStart(
    input: IDiscoveryDailyStartClaimInput,
  ): Promise<IDiscoveryDailyStartClaimResult> {
    this.claims.push(input);

    return {
      decision: this.decision,
      record: { ...input, createdAt: input.occurredAt },
    };
  }
}

class RecordingWorker {
  public calls = 0;

  public async triggerWork(): Promise<void> {
    this.calls += 1;
  }
}

describe('DiscoveryStartupCoordinator', () => {
  it('starts durable daily work only when its atomic claim is new', async () => {
    const repository = new RecordingDailyStartRepository(
      DISCOVERY_DAILY_START_DECISION.STARTED,
    );
    const worker = new RecordingWorker();
    const coordinator = new DiscoveryStartupCoordinator(
      repository,
      new FixedCampaignConfiguration(),
      new FixedClock(),
      worker,
      { businessTimezone: 'Europe/Chisinau' },
    );

    await coordinator.onApplicationBootstrap();

    expect(worker.calls).toBe(1);
    expect(repository.claims).toEqual([expect.objectContaining({
      businessDate: '2026-09-04',
      trigger: DISCOVERY_START_TRIGGER_KIND.AUTO_STARTUP,
    })]);
  });

  it('does not schedule a second provider-start attempt after a same-day restart', async () => {
    const repository = new RecordingDailyStartRepository(
      DISCOVERY_DAILY_START_DECISION.ALREADY_DECIDED,
    );
    const worker = new RecordingWorker();
    const coordinator = new DiscoveryStartupCoordinator(
      repository,
      new FixedCampaignConfiguration(),
      new FixedClock(),
      worker,
      { businessTimezone: 'Europe/Chisinau' },
    );

    await coordinator.onApplicationBootstrap();

    expect(worker.calls).toBe(0);
  });
});
