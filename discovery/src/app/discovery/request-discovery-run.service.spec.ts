import { DISCOVERY_SOURCE_KIND } from '../../domain/discovery/discovery-model.js';
import { IClockPort } from '../../ports/outbound/clock.port.js';
import { IDiscoveryCampaignConfigurationPort } from '../../ports/outbound/discovery-campaign-configuration.port.js';
import {
  IDiscoveryOperationRun,
  IDiscoveryOperationRunPage,
  IDiscoveryOperationRunRepositoryPort,
} from '../../ports/outbound/discovery-operation-run-repository.port.js';
import { IDiscoveryCampaignConfiguration } from './discovery-campaign-configuration.js';
import { RequestDiscoveryRunService } from './request-discovery-run.service.js';

class FixedClock implements IClockPort {
  public getCurrentTime(): Date {
    return new Date('2026-09-03T00:00:00.000Z');
  }
}

class ActiveCampaignConfiguration implements IDiscoveryCampaignConfigurationPort {
  public getCampaignConfiguration(): IDiscoveryCampaignConfiguration {
    return {
      campaignId: 'campaign-1',
      configurationHash: 'hash-1',
      limits: { dailyProviderItemLimit: 50, maxProviderItemsPerRun: 10 },
      scopes: [{ id: 'MD', label: 'Moldova', priority: 1 }],
      searchQueries: ['lead'],
      source: { actorId: 'google-maps-search', kind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS },
      version: 1,
    };
  }
}

class InMemoryOperationRuns implements IDiscoveryOperationRunRepositoryPort {
  private readonly runs: IDiscoveryOperationRun[] = [];

  public async findByIdempotencyKey(
    campaignId: string,
    idempotencyKey: string,
  ): Promise<IDiscoveryOperationRun | undefined> {
    return this.runs.find((run) => run.campaignId === campaignId && run.idempotencyKey === idempotencyKey);
  }

  public async claimNextAcceptedRun(): Promise<IDiscoveryOperationRun | undefined> {
    return undefined;
  }

  public async findRun(runId: string): Promise<IDiscoveryOperationRun | undefined> {
    return this.runs.find((run) => run.runId === runId);
  }

  public async listRuns(): Promise<IDiscoveryOperationRunPage> {
    return { items: this.runs, total: this.runs.length };
  }

  public async saveRun(run: IDiscoveryOperationRun): Promise<void> {
    this.runs.push(run);
  }
}

describe('RequestDiscoveryRunService', () => {
  it('persists and returns the prior command for a matching idempotency key', async () => {
    const service = new RequestDiscoveryRunService(
      new ActiveCampaignConfiguration(),
      new FixedClock(),
      new InMemoryOperationRuns(),
    );
    const first = await service.requestRun({
      campaignId: 'campaign-1',
      idempotencyKey: 'operator-command-1',
      maximumProviderItems: 10,
    });
    const duplicate = await service.requestRun({
      campaignId: 'campaign-1',
      idempotencyKey: 'operator-command-1',
      maximumProviderItems: 10,
    });

    expect(duplicate.runId).toBe(first.runId);
  });

  it('rejects a command above the configured provider item bound', async () => {
    const service = new RequestDiscoveryRunService(
      new ActiveCampaignConfiguration(),
      new FixedClock(),
      new InMemoryOperationRuns(),
    );

    await expect(service.requestRun({
      campaignId: 'campaign-1',
      maximumProviderItems: 11,
    })).rejects.toThrow(/run limit/);
  });
});
