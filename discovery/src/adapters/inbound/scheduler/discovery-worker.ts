import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  DISCOVERY_WORK_OUTCOME,
  DiscoveryProgressService,
} from '../../../app/discovery/discovery-progress.service.js';
import { writeDiscoveryFailureLog, writeDiscoveryLog } from '../bootstrap/discovery-structured-logger.js';

const DISCOVERY_WORK_INTERVAL_MILLISECONDS = 60_000;

@Injectable()
export class DiscoveryWorker {
  private isTickRunning = false;

  public constructor(
    private readonly discoveryProgressService: DiscoveryProgressService,
  ) {}

  @Interval(DISCOVERY_WORK_INTERVAL_MILLISECONDS)
  public async triggerScheduledWork(): Promise<void> {
    await this.triggerWork();
  }

  public async triggerWork(): Promise<DISCOVERY_WORK_OUTCOME | null> {
    if (this.isTickRunning) {
      return null;
    }

    this.isTickRunning = true;

    try {
      const correlationId = crypto.randomUUID();
      const result = await this.discoveryProgressService.advanceDiscoveryWork({
        correlationId,
        workerId: `discovery-worker-${process.pid}`,
      });

      writeDiscoveryLog({
        className: 'DiscoveryWorker',
        correlationId,
        input: result,
        level: 'info',
        method: 'triggerWork',
        operation: 'advance-discovery-work',
        retryable: false,
        service: 'discovery',
      });

      return result.outcome;
    } catch (error: unknown) {
      writeDiscoveryFailureLog({
        className: 'DiscoveryWorker',
        correlationId: crypto.randomUUID(),
        error,
        method: 'triggerWork',
        operation: 'advance-discovery-work',
        retryable: true,
      });

      throw error;
    } finally {
      this.isTickRunning = false;
    }
  }
}
