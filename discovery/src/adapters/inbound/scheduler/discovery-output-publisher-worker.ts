import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import {
  DiscoveryOutputPublisherService,
  DiscoveryOutputPublishingError,
  IPublishPendingDiscoveryOutputsResult,
} from '../../../app/discovery/discovery-output-publisher.service.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import {
  writeDiscoveryFailureLog,
  writeDiscoveryLog,
} from '../bootstrap/discovery-structured-logger.js';

const DISCOVERY_OUTPUT_PUBLICATION_INTERVAL_MILLISECONDS = 10_000;

@Injectable()
export class DiscoveryOutputPublisherWorker {
  private isTickRunning = false;

  public constructor(
    private readonly discoveryOutputPublisherService: DiscoveryOutputPublisherService,
    private readonly runtimeConfiguration: DiscoveryRuntimeConfiguration,
  ) {}

  @Interval(DISCOVERY_OUTPUT_PUBLICATION_INTERVAL_MILLISECONDS)
  public async triggerScheduledPublication(): Promise<void> {
    await this.triggerPublication();
  }

  public async triggerPublication(): Promise<IPublishPendingDiscoveryOutputsResult | null> {
    if (this.isTickRunning) {
      return null;
    }

    this.isTickRunning = true;
    const correlationId = crypto.randomUUID();

    try {
      const result = await this.discoveryOutputPublisherService
        .publishPendingDiscoveryOutputs({
          batchSize: this.runtimeConfiguration.rabbitmqPrefetch,
          correlationId,
          retryDelayMilliseconds: this.runtimeConfiguration.rabbitmqRetryDelayMs,
          retryMaximumAttempts: this.runtimeConfiguration.rabbitmqRetryMaxAttempts,
          workerId: `discovery-output-publisher-${process.pid}`,
        });

      writeDiscoveryLog({
        className: 'DiscoveryOutputPublisherWorker',
        correlationId,
        input: {
          claimedOutputCount: result.claimedOutputCount,
          confirmedOutputCount: result.confirmedOutputCount,
          retryScheduledOutputCount: result.retryScheduledOutputCount,
        },
        level: 'info',
        method: 'triggerPublication',
        operation: 'publish-discovery-output-batch',
        retryable: false,
        service: 'discovery',
      });

      for (const retryScheduledOutput of result.retryScheduledOutputs) {
        writeDiscoveryFailureLog({
          brokerOperation: 'publish-discovered-lead',
          campaignId: retryScheduledOutput.campaignId,
          className: 'DiscoveryOutputPublisherWorker',
          correlationId,
          error: new Error(retryScheduledOutput.failure.message),
          eventId: retryScheduledOutput.eventId,
          input: {
            failureKind: retryScheduledOutput.failure.kind,
            nextAttemptAt: retryScheduledOutput.nextAttemptAt.toISOString(),
            outputId: retryScheduledOutput.outputId,
          },
          method: 'triggerPublication',
          operation: 'publish-discovery-output',
          retryable: retryScheduledOutput.failure.retryable,
        });
      }

      return result;
    } catch (error: unknown) {
      const context = getFailureContext(error);

      writeDiscoveryFailureLog({
        campaignId: context.campaignId,
        className: 'DiscoveryOutputPublisherWorker',
        correlationId,
        error,
        eventId: context.eventId,
        input: context.input,
        method: 'triggerPublication',
        operation: 'publish-discovery-output-batch',
        retryable: true,
      });

      throw error;
    } finally {
      this.isTickRunning = false;
    }
  }
}

interface IDiscoveryOutputPublisherFailureContext {
  readonly campaignId?: string;
  readonly eventId?: string;
  readonly input: unknown;
}

function getFailureContext(
  error: unknown,
): IDiscoveryOutputPublisherFailureContext {
  if (!(error instanceof DiscoveryOutputPublishingError)) {
    return { input: {} };
  }

  return {
    campaignId: error.context.campaignId,
    eventId: error.context.eventId,
    input: error.context,
  };
}
