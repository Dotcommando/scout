import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';

import type { IClockPort } from '../../../ports/outbound/clock.port.js';
import type { IDiscoveryCampaignConfigurationPort } from '../../../ports/outbound/discovery-campaign-configuration.port.js';
import type { IDiscoveryDailyStartRepositoryPort } from '../../../ports/outbound/discovery-daily-start-repository.port.js';
import {
  DISCOVERY_DAILY_START_DECISION,
  DISCOVERY_DAILY_START_REPOSITORY,
  DISCOVERY_START_TRIGGER_KIND,
} from '../../../ports/outbound/discovery-daily-start-repository.port.js';
import { SystemClock } from '../../outbound/time/system-clock.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import { writeDiscoveryLog } from '../bootstrap/discovery-structured-logger.js';
import { MongoDiscoveryCampaignConfiguration } from '../configuration/mongo-discovery-campaign-configuration.js';
import { DiscoveryWorker } from './discovery-worker.js';

@Injectable()
export class DiscoveryStartupCoordinator implements OnApplicationBootstrap {
  public constructor(
    @Inject(DISCOVERY_DAILY_START_REPOSITORY)
    private readonly dailyStartRepository: IDiscoveryDailyStartRepositoryPort,
    @Inject(MongoDiscoveryCampaignConfiguration)
    private readonly campaignConfiguration: IDiscoveryCampaignConfigurationPort,
    @Inject(SystemClock)
    private readonly clock: IClockPort,
    @Inject(DiscoveryWorker)
    private readonly discoveryWorker: IDiscoveryStartupWorker,
    @Inject(DiscoveryRuntimeConfiguration)
    private readonly runtimeConfiguration: IDiscoveryStartupRuntimeConfiguration,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    const configuration = this.campaignConfiguration.getCampaignConfiguration();
    const occurredAt = this.clock.getCurrentTime();
    const correlationId = crypto.randomUUID();
    const claim = await this.dailyStartRepository.claimDailyStart({
      businessDate: getBusinessDate(occurredAt, this.runtimeConfiguration.businessTimezone),
      campaignId: configuration.campaignId,
      configurationHash: configuration.configurationHash,
      occurredAt,
      timezone: this.runtimeConfiguration.businessTimezone,
      trigger: DISCOVERY_START_TRIGGER_KIND.AUTO_STARTUP,
    });

    writeDiscoveryLog({
      campaignId: configuration.campaignId,
      className: 'DiscoveryStartupCoordinator',
      correlationId,
      input: { businessDate: claim.record.businessDate, decision: claim.decision },
      level: 'info',
      method: 'onApplicationBootstrap',
      operation: 'claim-daily-start',
      retryable: false,
      service: 'discovery',
    });

    if (claim.decision === DISCOVERY_DAILY_START_DECISION.STARTED) {
      await this.discoveryWorker.triggerWork();
    }
  }
}

interface IDiscoveryStartupRuntimeConfiguration {
  readonly businessTimezone: string;
}

interface IDiscoveryStartupWorker {
  triggerWork(): Promise<unknown>;
}

function getBusinessDate(currentTime: Date, timezone: string): string {
  const pieces = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).formatToParts(currentTime);
  const values = new Map(pieces.map((piece) => [piece.type, piece.value]));
  const day = values.get('day');
  const month = values.get('month');
  const year = values.get('year');

  if (day === undefined || month === undefined || year === undefined) {
    throw new Error('business date could not be formatted');
  }

  return `${year}-${month}-${day}`;
}
