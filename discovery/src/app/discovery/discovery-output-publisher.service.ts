import {
  IClockPort,
} from '../../ports/outbound/clock.port.js';
import {
  IDiscoveredLeadMessagePublisherPort,
} from '../../ports/outbound/discovered-lead-message-publisher.port.js';
import {
  DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND,
  IClaimedDiscoveryOutput,
  IDiscoveryOutputPublicationFailure,
  IDiscoveryOutputRepositoryPort,
} from '../../ports/outbound/discovery-output-repository.port.js';
import { toDiscoveredLeadEvent } from './discovery-output-payload.js';

const DISCOVERY_OUTPUT_PUBLISHER_LEASE_MILLISECONDS = 60_000;

export enum DISCOVERY_OUTPUT_PUBLICATION_OUTCOME {
  CONFIRMED = 'confirmed',
  RETRY_SCHEDULED = 'retry-scheduled',
}

export interface IPublishPendingDiscoveryOutputsInput {
  readonly batchSize: number;
  readonly correlationId: string;
  readonly retryDelayMilliseconds: number;
  readonly retryMaximumAttempts: number;
  readonly workerId: string;
}

export interface IPublishPendingDiscoveryOutputsResult {
  readonly claimedOutputCount: number;
  readonly confirmedOutputCount: number;
  readonly retryScheduledOutputs: readonly IRetryScheduledDiscoveryOutput[];
  readonly retryScheduledOutputCount: number;
}

export interface IRetryScheduledDiscoveryOutput {
  readonly campaignId: string;
  readonly eventId?: string;
  readonly failure: IDiscoveryOutputPublicationFailure;
  readonly nextAttemptAt: Date;
  readonly outputId: string;
}

export interface IDiscoveryOutputPublishingFailureContext {
  readonly campaignId: string;
  readonly eventId?: string;
  readonly outputId: string;
}

export class DiscoveryOutputPublishingError extends Error {
  public constructor(
    public readonly context: IDiscoveryOutputPublishingFailureContext,
    cause: unknown,
  ) {
    super('Discovery output publication state update failed', { cause });
    this.name = 'DiscoveryOutputPublishingError';
  }
}

export class DiscoveryOutputPublisherService {
  public constructor(
    private readonly clock: IClockPort,
    private readonly discoveryOutputRepository: IDiscoveryOutputRepositoryPort,
    private readonly discoveredLeadMessagePublisher: IDiscoveredLeadMessagePublisherPort,
  ) {}

  public async publishPendingDiscoveryOutputs(
    input: IPublishPendingDiscoveryOutputsInput,
  ): Promise<IPublishPendingDiscoveryOutputsResult> {
    const currentTime = this.clock.getCurrentTime();
    const outputs = await this.discoveryOutputRepository.claimPendingDiscoveryOutputs({
      claimedAt: currentTime,
      leaseExpiresAt: new Date(
        currentTime.getTime() + DISCOVERY_OUTPUT_PUBLISHER_LEASE_MILLISECONDS,
      ),
      limit: input.batchSize,
      retryEligibleAt: currentTime,
      workerId: input.workerId,
    });
    let confirmedOutputCount = 0;
    let retryScheduledOutputCount = 0;
    const retryScheduledOutputs: IRetryScheduledDiscoveryOutput[] = [];

    for (const output of outputs) {
      const publication = await this.publishClaimedOutput(output, input);

      if (publication.outcome === DISCOVERY_OUTPUT_PUBLICATION_OUTCOME.CONFIRMED) {
        confirmedOutputCount += 1;
      } else {
        if (publication.retryScheduledOutput === undefined) {
          throw this.createStateUpdateError(
            output,
            new Error('retry outcome did not include failure context'),
          );
        }

        retryScheduledOutputCount += 1;
        retryScheduledOutputs.push(publication.retryScheduledOutput);
      }
    }

    return {
      claimedOutputCount: outputs.length,
      confirmedOutputCount,
      retryScheduledOutputs,
      retryScheduledOutputCount,
    };
  }

  private async publishClaimedOutput(
    output: IClaimedDiscoveryOutput,
    input: IPublishPendingDiscoveryOutputsInput,
  ): Promise<IClaimedOutputPublicationResult> {
    try {
      if (output.payload === undefined) {
        throw new DiscoveryMessagePublicationError(
          DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND.INVALID_PAYLOAD,
          false,
          `Discovery output ${output.outputId} does not contain a transport payload`,
        );
      }

      await this.discoveredLeadMessagePublisher.publishDiscoveredLead(
        toDiscoveredLeadEvent(output.payload),
      );

      const confirmedAt = this.clock.getCurrentTime();
      const confirmed = await this.discoveryOutputRepository
        .confirmDiscoveryOutputPublication({
          confirmedAt,
          outputId: output.outputId,
          workerId: input.workerId,
        });

      if (!confirmed) {
        throw this.createStateUpdateError(
          output,
          new Error('publisher claim was not held while confirming publication'),
        );
      }

      return { outcome: DISCOVERY_OUTPUT_PUBLICATION_OUTCOME.CONFIRMED };
    } catch (error: unknown) {
      if (error instanceof DiscoveryOutputPublishingError) {
        throw error;
      }

      const failedAt = this.clock.getCurrentTime();
      const failure = {
        kind: classifyPublicationFailure(error),
        message: getErrorMessage(error),
        occurredAt: failedAt,
        retryable: isRetryablePublicationFailure(error),
      };
      const nextAttemptAt = new Date(
        failedAt.getTime()
          + calculateRetryDelayMilliseconds(
            output.publishAttemptCount,
            input.retryDelayMilliseconds,
            input.retryMaximumAttempts,
          ),
      );
      const recorded = await this.discoveryOutputRepository
        .recordDiscoveryOutputPublicationFailure({
          failure,
          nextAttemptAt,
          outputId: output.outputId,
          workerId: input.workerId,
        });

      if (!recorded) {
        throw this.createStateUpdateError(
          output,
          new Error('publisher claim was not held while recording publication failure'),
        );
      }

      return {
        outcome: DISCOVERY_OUTPUT_PUBLICATION_OUTCOME.RETRY_SCHEDULED,
        retryScheduledOutput: {
          campaignId: output.campaignId,
          ...(output.payload === undefined
            ? {}
            : { eventId: output.payload.eventId }),
          failure,
          nextAttemptAt,
          outputId: output.outputId,
        },
      };
    }
  }

  private createStateUpdateError(
    output: IClaimedDiscoveryOutput,
    cause: unknown,
  ): DiscoveryOutputPublishingError {
    return new DiscoveryOutputPublishingError(
      {
        campaignId: output.campaignId,
        ...(output.payload === undefined
          ? {}
          : { eventId: output.payload.eventId }),
        outputId: output.outputId,
      },
      cause,
    );
  }
}

interface IClaimedOutputPublicationResult {
  readonly outcome: DISCOVERY_OUTPUT_PUBLICATION_OUTCOME;
  readonly retryScheduledOutput?: IRetryScheduledDiscoveryOutput;
}

export class DiscoveryMessagePublicationError extends Error {
  public constructor(
    public readonly kind: DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND,
    public readonly retryable: boolean,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? {} : { cause });
    this.name = 'DiscoveryMessagePublicationError';
  }
}

function calculateRetryDelayMilliseconds(
  publishAttemptCount: number,
  retryDelayMilliseconds: number,
  retryMaximumAttempts: number,
): number {
  const exponent = Math.min(
    Math.max(publishAttemptCount - 1, 0),
    retryMaximumAttempts,
  );

  return retryDelayMilliseconds * 2 ** exponent;
}

function classifyPublicationFailure(
  error: unknown,
): DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND {
  return error instanceof DiscoveryMessagePublicationError
    ? error.kind
    : DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND.UNKNOWN;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryablePublicationFailure(error: unknown): boolean {
  return error instanceof DiscoveryMessagePublicationError
    ? error.retryable
    : true;
}
