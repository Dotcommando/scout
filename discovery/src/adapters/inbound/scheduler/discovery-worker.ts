import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import type {
  IDiscoveryWorkUseCase,
} from '../../../app/discovery/discovery-progress.service.js';
import {
  DISCOVERY_WORK_OUTCOME,
  DiscoveryWorkError,
} from '../../../app/discovery/discovery-progress.service.js';
import { writeDiscoveryFailureLog, writeDiscoveryLog } from '../bootstrap/discovery-structured-logger.js';

const DISCOVERY_WORK_INTERVAL_MILLISECONDS = 60_000;

@Injectable()
export class DiscoveryWorker {
  private isTickRunning = false;

  public constructor(
    private readonly discoveryWorkUseCase: IDiscoveryWorkUseCase,
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
    const correlationId = crypto.randomUUID();

    try {
      const result = await this.discoveryWorkUseCase.advanceDiscoveryWork({
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
      const context = getFailureContext(error);

      writeDiscoveryFailureLog({
        ...(context.attempt === undefined ? {} : { attempt: context.attempt }),
        campaignId: context.campaignId,
        className: 'DiscoveryWorker',
        correlationId,
        error,
        input: context.input,
        method: 'triggerWork',
        operation: 'advance-discovery-work',
        ...(context.providerRunId === undefined
          ? {}
          : { providerRunId: context.providerRunId }),
        retryable: context.retryable,
        sourceKind: context.sourceKind,
        ...(context.scopeId === undefined ? {} : { scopeId: context.scopeId }),
      });

      throw error;
    } finally {
      this.isTickRunning = false;
    }
  }
}

interface IDiscoveryWorkerFailureContext {
  readonly attempt?: number;
  readonly campaignId?: string;
  readonly input: unknown;
  readonly providerRunId?: string;
  readonly retryable: boolean;
  readonly scopeId?: string;
  readonly sourceKind?: string;
}

function getFailureContext(error: unknown): IDiscoveryWorkerFailureContext {
  if (!(error instanceof DiscoveryWorkError)) {
    return {
      input: {},
      retryable: true,
    };
  }

  return {
    ...(error.context.attempt === undefined
      ? {}
      : { attempt: error.context.attempt }),
    campaignId: error.context.campaignId,
    input: {
      campaignId: error.context.campaignId,
      ...(error.context.providerRunId === undefined
        ? {}
        : { providerRunId: error.context.providerRunId }),
      ...(error.context.scopeId === undefined
        ? {}
        : { scopeId: error.context.scopeId }),
    },
    ...(error.context.providerRunId === undefined
      ? {}
      : { providerRunId: error.context.providerRunId }),
    retryable: error.retryable,
    ...(error.context.scopeId === undefined
      ? {}
      : { scopeId: error.context.scopeId }),
    sourceKind: error.context.sourceKind,
  };
}
