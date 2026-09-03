import { randomUUID } from 'node:crypto';

import { IClockPort } from '../../ports/outbound/clock.port.js';
import { IDiscoveryCampaignConfigurationPort } from '../../ports/outbound/discovery-campaign-configuration.port.js';
import {
  DISCOVERY_OPERATION_RUN_STATUS,
  DISCOVERY_OPERATION_RUN_TRIGGER,
  IDiscoveryOperationRun,
  IDiscoveryOperationRunRepositoryPort,
} from '../../ports/outbound/discovery-operation-run-repository.port.js';

export interface IRequestDiscoveryRunInput {
  readonly campaignId: string;
  readonly idempotencyKey?: string;
  readonly maximumProviderItems: number;
}

export class RequestDiscoveryRunService {
  public constructor(
    private readonly campaignConfiguration: IDiscoveryCampaignConfigurationPort,
    private readonly clock: IClockPort,
    private readonly operationRunRepository: IDiscoveryOperationRunRepositoryPort,
  ) {}

  public async requestRun(input: IRequestDiscoveryRunInput): Promise<IDiscoveryOperationRun> {
    const configuration = this.campaignConfiguration.getCampaignConfiguration();

    if (input.campaignId !== configuration.campaignId) {
      throw new Error(`Discovery campaign ${input.campaignId} is not active`);
    }
    if (!Number.isSafeInteger(input.maximumProviderItems)
      || input.maximumProviderItems < 1
      || input.maximumProviderItems > configuration.limits.maxProviderItemsPerRun) {
      throw new Error('maximumProviderItems exceeds the active campaign run limit');
    }

    const idempotencyKey = input.idempotencyKey ?? randomUUID();
    const existing = await this.operationRunRepository.findByIdempotencyKey(
      input.campaignId,
      idempotencyKey,
    );

    if (existing !== undefined) {
      if (existing.maximumProviderItems !== input.maximumProviderItems) {
        throw new Error('idempotencyKey was already used with a different request');
      }

      return existing;
    }

    const currentTime = this.clock.getCurrentTime();
    const run: IDiscoveryOperationRun = {
      campaignId: configuration.campaignId,
      configurationHash: configuration.configurationHash,
      correlationId: randomUUID(),
      createdAt: currentTime,
      idempotencyKey,
      maximumProviderItems: input.maximumProviderItems,
      runId: randomUUID(),
      status: DISCOVERY_OPERATION_RUN_STATUS.ACCEPTED,
      trigger: DISCOVERY_OPERATION_RUN_TRIGGER.MANUAL,
      updatedAt: currentTime,
    };

    await this.operationRunRepository.saveRun(run);

    return run;
  }
}
