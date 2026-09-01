import { IClockPort } from '../../ports/outbound/clock.port.js';
import {
  IDiscoveryCampaignConfigurationPort,
} from '../../ports/outbound/discovery-campaign-configuration.port.js';
import {
  IDiscoveryStateRepositoryPort,
} from '../../ports/outbound/discovery-state-repository.port.js';
import {
  IProviderQuotaRepositoryPort,
} from '../../ports/outbound/provider-quota-repository.port.js';

export enum DISCOVERY_WORK_OUTCOME {
  BUDGET_EXHAUSTED = 'budget-exhausted',
  IDLE = 'idle',
  SCOPE_CLAIMED = 'scope-claimed',
}

export interface IAdvanceDiscoveryWorkInput {
  readonly correlationId: string;
  readonly workerId: string;
}

export interface IAdvanceDiscoveryWorkResult {
  readonly outcome: DISCOVERY_WORK_OUTCOME;
  readonly reservedItemCount?: number;
  readonly scopeId?: string;
}

export class DiscoveryProgressService {
  public constructor(
    private readonly campaignConfiguration: IDiscoveryCampaignConfigurationPort,
    private readonly clock: IClockPort,
    private readonly scopeRepository: IDiscoveryStateRepositoryPort,
    private readonly quotaRepository: IProviderQuotaRepositoryPort,
  ) {}

  public async advanceDiscoveryWork(
    input: IAdvanceDiscoveryWorkInput,
  ): Promise<IAdvanceDiscoveryWorkResult> {
    const configuration = this.campaignConfiguration.getCampaignConfiguration();
    const currentTime = this.clock.getCurrentTime();

    await this.scopeRepository.synchronizeConfiguredScopes({
      campaignId: configuration.campaignId,
      configurationHash: configuration.configurationHash,
      scopes: configuration.scopes.map((scope) => ({
        priority: scope.priority,
        scopeId: scope.id,
      })),
      synchronizedAt: currentTime,
    });

    const scope = await this.scopeRepository.claimNextEligibleScope({
      campaignId: configuration.campaignId,
      claimedAt: currentTime,
      workerId: input.workerId,
    });

    if (scope === null) {
      return {
        outcome: DISCOVERY_WORK_OUTCOME.IDLE,
      };
    }

    const reservation = await this.quotaRepository.reserveDailyQuota({
      campaignId: configuration.campaignId,
      dailyItemLimit: configuration.limits.dailyProviderItemLimit,
      quotaDay: getUtcQuotaDay(currentTime),
      requestedItemCount: configuration.limits.maxProviderItemsPerRun,
    });

    if (reservation === null) {
      const released = await this.scopeRepository.releaseScopeClaim({
        campaignId: configuration.campaignId,
        releasedAt: currentTime,
        scopeId: scope.scopeId,
        workerId: input.workerId,
      });

      if (!released) {
        throw new Error('claimed scope could not be released after quota exhaustion');
      }

      return {
        outcome: DISCOVERY_WORK_OUTCOME.BUDGET_EXHAUSTED,
      };
    }

    return {
      outcome: DISCOVERY_WORK_OUTCOME.SCOPE_CLAIMED,
      reservedItemCount: reservation.reservedItemCount,
      scopeId: scope.scopeId,
    };
  }
}

function getUtcQuotaDay(currentTime: Date): string {
  return currentTime.toISOString().slice(0, 10);
}
