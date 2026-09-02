import { LIVE_DISCOVERY_EXECUTION_PURPOSE } from '../../../domain/discovery/live-discovery-execution-model.js';
import { ILiveDiscoveryExecutionConfigurationPort } from '../../../ports/outbound/live-discovery-execution-configuration.port.js';
import { ILiveDiscoveryExecutionRepositoryPort } from '../../../ports/outbound/live-discovery-execution-repository.port.js';
import { IProviderQuotaRepositoryPort, IProviderQuotaReservation, IReserveDailyQuotaInput } from '../../../ports/outbound/provider-quota-repository.port.js';

export class LiveProviderQuotaRepository implements IProviderQuotaRepositoryPort {
  public constructor(
    private readonly campaignConfigurationHash: string,
    private readonly executionConfiguration: ILiveDiscoveryExecutionConfigurationPort,
    private readonly executionId: string,
    private readonly executionRepository: ILiveDiscoveryExecutionRepositoryPort,
    private readonly purpose: LIVE_DISCOVERY_EXECUTION_PURPOSE,
    private readonly quotaRepository: IProviderQuotaRepositoryPort,
  ) {}

  public async reserveDailyQuota(input: IReserveDailyQuotaInput): Promise<IProviderQuotaReservation | null> {
    const configuration = this.executionConfiguration.getLiveExecutionConfiguration();
    const expectedMaximumItemCount = this.purpose === LIVE_DISCOVERY_EXECUTION_PURPOSE.PREFLIGHT
      ? configuration.preflightMaximumProviderItems
      : configuration.maximumProviderItemsPerRun;

    if (input.requestedItemCount !== expectedMaximumItemCount) {
      return null;
    }

    const reservation = await this.executionRepository.reserveProviderRun({
      campaignId: input.campaignId,
      configurationHash: this.campaignConfigurationHash,
      executionId: this.executionId,
      maximumItemCount: input.requestedItemCount,
      maximumPlanProviderItems: configuration.maximumPlanProviderItems,
      maximumPlanProviderRuns: configuration.maximumPlanProviderRuns,
      planId: configuration.planId,
      purpose: this.purpose,
      reservedAt: new Date(),
    });

    if (reservation === null) {
      return null;
    }

    const dailyReservation = await this.quotaRepository.reserveDailyQuota({
      ...input,
      campaignId: `${input.campaignId}-${this.purpose}`,
      dailyItemLimit: 100,
    });

    return dailyReservation;
  }
}
