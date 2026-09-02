import {
  DiscoveredLeadEventValidationError,
  IDiscoveredLeadEvent,
  parseDiscoveredLeadEvent,
} from '@scout/contracts';

import {
  IQualifyLeadResult,
  IQualifyLeadUseCase,
  QUALIFY_LEAD_OUTCOME,
} from '../../../ports/inbound/qualify-lead.use-case.js';
import {
  QualificationProfileConfigurationValidationError,
} from '../configuration/qualification-profile-configuration.js';

export enum QUALIFICATION_MESSAGE_FAILURE_KIND {
  INVALID_CONTRACT = 'invalid-contract',
  PERMANENT_INPUT = 'permanent-input',
  TRANSIENT_PROCESSING = 'transient-processing',
}

export const QUALIFICATION_MESSAGE_FAILURE_KIND_ARRAY = Object.values(
  QUALIFICATION_MESSAGE_FAILURE_KIND,
);

export enum QUALIFICATION_MESSAGE_HANDLING_OUTCOME {
  DEAD_LETTER = 'dead-letter',
  PROCESSED = 'processed',
  RETRY = 'retry',
}

export interface IInboundBrokerDelivery {
  readonly body: Buffer;
  readonly correlationId?: string;
  readonly messageId?: string;
  readonly retryAttempt: number;
}

export interface IDeadLetterMessageHandlingResult {
  readonly errorMessage: string;
  readonly event?: IDiscoveredLeadEvent;
  readonly failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND;
  readonly outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.DEAD_LETTER;
}

export interface IProcessedMessageHandlingResult {
  readonly event: IDiscoveredLeadEvent;
  readonly outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.PROCESSED;
  readonly qualification: IQualifyLeadResult;
}

export interface IRetryMessageHandlingResult {
  readonly errorMessage: string;
  readonly event?: IDiscoveredLeadEvent;
  readonly failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND;
  readonly outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.RETRY;
}

export type QualificationMessageHandlingResult =
  | IDeadLetterMessageHandlingResult
  | IProcessedMessageHandlingResult
  | IRetryMessageHandlingResult;

export class RabbitMqDiscoveredLeadMessageHandler {
  public constructor(private readonly qualifyLeadUseCase: IQualifyLeadUseCase) {}

  public async handleDelivery(
    delivery: IInboundBrokerDelivery,
    workerId: string,
  ): Promise<QualificationMessageHandlingResult> {
    const event = this.parseEvent(delivery);

    if (event instanceof Error) {
      return {
        errorMessage: event.message,
        failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND.INVALID_CONTRACT,
        outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.DEAD_LETTER,
      };
    }

    try {
      const qualification = await this.qualifyLeadUseCase.qualifyLead({
        campaignId: event.campaignId,
        correlationId: event.correlationId,
        eventId: event.eventId,
        lead: event.lead,
        occurredAt: new Date(event.occurredAt),
        workerId,
      });

      if (qualification.outcome === QUALIFY_LEAD_OUTCOME.IN_PROGRESS) {
        return {
          errorMessage: 'qualification execution is currently held by another worker',
          event,
          failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND.TRANSIENT_PROCESSING,
          outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.RETRY,
        };
      }

      return {
        event,
        outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.PROCESSED,
        qualification,
      };
    } catch (error: unknown) {
      if (error instanceof QualificationProfileConfigurationValidationError) {
        return {
          errorMessage: error.message,
          event,
          failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND.PERMANENT_INPUT,
          outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.DEAD_LETTER,
        };
      }

      return {
        errorMessage: getErrorMessage(error),
        event,
        failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND.TRANSIENT_PROCESSING,
        outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.RETRY,
      };
    }
  }

  private parseEvent(
    delivery: IInboundBrokerDelivery,
  ): IDiscoveredLeadEvent | Error {
    try {
      const parsedBody = JSON.parse(delivery.body.toString('utf8'));
      const event = parseDiscoveredLeadEvent(parsedBody);

      if (delivery.messageId !== event.eventId) {
        throw new DiscoveredLeadEventValidationError(
          'messageId',
          'must equal eventId',
        );
      }
      if (delivery.correlationId !== event.correlationId) {
        throw new DiscoveredLeadEventValidationError(
          'correlationId',
          'must equal the event correlationId',
        );
      }

      return event;
    } catch (error: unknown) {
      return error instanceof Error
        ? error
        : new Error('broker delivery could not be parsed');
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
