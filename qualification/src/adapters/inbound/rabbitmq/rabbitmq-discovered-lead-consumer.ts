import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IDiscoveredLeadEvent } from '@scout/contracts';
import { ConfirmChannel, connect, ConsumeMessage } from 'amqplib';

import { QualificationService } from '../../../app/qualification/qualification.service.js';
import { QualificationRuntimeConfiguration } from '../bootstrap/qualification-runtime-configuration.js';
import {
  writeQualificationFailureLog,
  writeQualificationLog,
} from '../bootstrap/qualification-structured-logger.js';
import {
  IInboundBrokerDelivery,
  QUALIFICATION_MESSAGE_FAILURE_KIND,
  QUALIFICATION_MESSAGE_HANDLING_OUTCOME,
  RabbitMqDiscoveredLeadMessageHandler,
} from './rabbitmq-discovered-lead-message-handler.js';

const DISCOVERED_LEAD_EXCHANGE = 'discovery.lead.v1';
const DISCOVERED_LEAD_ROUTING_KEY = 'lead.discovered.v1';
const QUALIFICATION_DEAD_LETTER_QUEUE =
  'qualification.discovered-lead.v1.dead-letter';
const QUALIFICATION_INPUT_QUEUE = 'qualification.discovered-lead.v1';
const QUALIFICATION_RETRY_FIVE_MINUTES_QUEUE =
  'qualification.discovered-lead.v1.retry.5m';
const QUALIFICATION_RETRY_THIRTY_SECONDS_QUEUE =
  'qualification.discovered-lead.v1.retry.30s';
const RETRY_FIVE_MINUTES_MILLISECONDS = 5 * 60 * 1000;
const RETRY_THIRTY_SECONDS_MILLISECONDS = 30 * 1000;
const RETRY_ATTEMPT_HEADER = 'x-qualification-retry-attempt';
const FAILURE_KIND_HEADER = 'x-qualification-failure-kind';
const FAILURE_MESSAGE_HEADER = 'x-qualification-failure-message';
const MAXIMUM_FAILURE_MESSAGE_LENGTH = 500;

@Injectable()
export class RabbitMqDiscoveredLeadConsumer
  implements OnModuleDestroy, OnModuleInit {
  private acceptingDeliveries = true;
  private channel: ConfirmChannel | undefined;
  private connection: Awaited<ReturnType<typeof connect>> | undefined;
  private consumerTag: string | undefined;
  private readonly inFlightDeliveries = new Set<Promise<void>>();
  private readonly messageHandler: RabbitMqDiscoveredLeadMessageHandler;

  public constructor(
    private readonly qualificationService: QualificationService,
    private readonly runtimeConfiguration: QualificationRuntimeConfiguration,
  ) {
    this.messageHandler = new RabbitMqDiscoveredLeadMessageHandler(
      qualificationService,
    );
  }

  public async onModuleDestroy(): Promise<void> {
    this.acceptingDeliveries = false;

    if (this.channel !== undefined && this.consumerTag !== undefined) {
      await this.channel.cancel(this.consumerTag);
    }

    await Promise.all(this.inFlightDeliveries);

    if (this.channel !== undefined) {
      await this.channel.close();
    }
    if (this.connection !== undefined) {
      await this.connection.close();
    }

    writeQualificationLog({
      brokerOperation: 'close-discovered-lead-consumer',
      className: 'RabbitMqDiscoveredLeadConsumer',
      correlationId: crypto.randomUUID(),
      level: 'info',
      method: 'onModuleDestroy',
      operation: 'stop-message-consumption',
      retryable: false,
      service: 'qualification',
    });
  }

  public async onModuleInit(): Promise<void> {
    try {
      this.connection = await connect(this.runtimeConfiguration.rabbitmqUri);
      this.connection.on('error', () => undefined);
      this.channel = await this.connection.createConfirmChannel();
      this.channel.on('error', () => undefined);
      await this.declareTopology(this.channel);
      await this.channel.prefetch(this.runtimeConfiguration.rabbitmqPrefetch);
      const consumer = await this.channel.consume(
        QUALIFICATION_INPUT_QUEUE,
        (message) => this.receiveDelivery(message),
        { noAck: false },
      );

      this.consumerTag = consumer.consumerTag;

      writeQualificationLog({
        brokerOperation: 'consume-discovered-lead',
        className: 'RabbitMqDiscoveredLeadConsumer',
        correlationId: crypto.randomUUID(),
        input: {
          prefetch: this.runtimeConfiguration.rabbitmqPrefetch,
          queue: QUALIFICATION_INPUT_QUEUE,
        },
        level: 'info',
        method: 'onModuleInit',
        operation: 'start-message-consumption',
        retryable: true,
        service: 'qualification',
      });
    } catch (error: unknown) {
      await this.closeAfterStartFailure();

      writeQualificationFailureLog({
        brokerOperation: 'consume-discovered-lead',
        className: 'RabbitMqDiscoveredLeadConsumer',
        correlationId: crypto.randomUUID(),
        error,
        method: 'onModuleInit',
        operation: 'start-message-consumption',
        retryable: true,
      });

      throw error;
    }
  }

  private async declareTopology(channel: ConfirmChannel): Promise<void> {
    await channel.assertExchange(DISCOVERED_LEAD_EXCHANGE, 'topic', {
      durable: true,
    });
    await channel.assertQueue(QUALIFICATION_DEAD_LETTER_QUEUE, {
      durable: true,
    });
    await channel.assertQueue(QUALIFICATION_INPUT_QUEUE, {
      durable: true,
    });
    await channel.bindQueue(
      QUALIFICATION_INPUT_QUEUE,
      DISCOVERED_LEAD_EXCHANGE,
      DISCOVERED_LEAD_ROUTING_KEY,
    );
    await channel.assertQueue(QUALIFICATION_RETRY_THIRTY_SECONDS_QUEUE, {
      arguments: {
        'x-dead-letter-exchange': DISCOVERED_LEAD_EXCHANGE,
        'x-dead-letter-routing-key': DISCOVERED_LEAD_ROUTING_KEY,
        'x-message-ttl': RETRY_THIRTY_SECONDS_MILLISECONDS,
      },
      durable: true,
    });
    await channel.assertQueue(QUALIFICATION_RETRY_FIVE_MINUTES_QUEUE, {
      arguments: {
        'x-dead-letter-exchange': DISCOVERED_LEAD_EXCHANGE,
        'x-dead-letter-routing-key': DISCOVERED_LEAD_ROUTING_KEY,
        'x-message-ttl': RETRY_FIVE_MINUTES_MILLISECONDS,
      },
      durable: true,
    });
  }

  private receiveDelivery(message: ConsumeMessage | null): void {
    if (message === null || !this.acceptingDeliveries) {
      return;
    }

    const delivery = this.processDelivery(message);

    this.inFlightDeliveries.add(delivery);
    void delivery.finally(() => this.inFlightDeliveries.delete(delivery));
  }

  private async processDelivery(message: ConsumeMessage): Promise<void> {
    const channel = this.requireChannel();
    const startedAt = Date.now();
    const delivery = createInboundBrokerDelivery(message);
    const workerId = `qualification-consumer-${process.pid}`;

    try {
      const result = await this.messageHandler.handleDelivery(delivery, workerId);

      if (result.outcome === QUALIFICATION_MESSAGE_HANDLING_OUTCOME.PROCESSED) {
        channel.ack(message);

        writeQualificationLog({
          attempt: delivery.retryAttempt,
          brokerMessageId: delivery.messageId,
          brokerOperation: 'ack-discovered-lead',
          campaignId: result.event.campaignId,
          className: 'RabbitMqDiscoveredLeadConsumer',
          correlationId: result.event.correlationId,
          decision: result.qualification.decision?.decision,
          durationMs: Date.now() - startedAt,
          eventId: result.event.eventId,
          leadId: result.event.lead.leadId,
          level: 'info',
          method: 'processDelivery',
          operation: 'qualify-discovered-lead',
          profileVersion: result.qualification.profileVersion,
          retryable: false,
          service: 'qualification',
        });

        return;
      }
      if (result.outcome === QUALIFICATION_MESSAGE_HANDLING_OUTCOME.RETRY) {
        await this.retryOrDeadLetter(
          channel,
          message,
          delivery,
          result.errorMessage,
          result.event,
          result.failureKind,
          startedAt,
        );

        return;
      }

      await this.deadLetter(
        channel,
        message,
        delivery,
        result.errorMessage,
        result.event,
        result.failureKind,
        startedAt,
      );
    } catch (error: unknown) {
      this.logUnexpectedProcessingFailure(error, delivery, startedAt);
      channel.nack(message, false, true);
    }
  }

  private async retryOrDeadLetter(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    delivery: IInboundBrokerDelivery,
    errorMessage: string,
    event: IDiscoveredLeadEvent | undefined,
    failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND,
    startedAt: number,
  ): Promise<void> {
    const nextAttempt = delivery.retryAttempt + 1;

    if (nextAttempt > this.runtimeConfiguration.rabbitmqRetryMaxAttempts) {
      await this.deadLetter(
        channel,
        message,
        delivery,
        errorMessage,
        event,
        failureKind,
        startedAt,
      );

      return;
    }

    const retryQueue = nextAttempt === 1
      ? QUALIFICATION_RETRY_THIRTY_SECONDS_QUEUE
      : QUALIFICATION_RETRY_FIVE_MINUTES_QUEUE;

    channel.sendToQueue(
      retryQueue,
      message.content,
      createForwardProperties(message, delivery, {
        [RETRY_ATTEMPT_HEADER]: nextAttempt,
      }),
    );
    await channel.waitForConfirms();
    channel.ack(message);

    writeQualificationFailureLog({
      attempt: nextAttempt,
      brokerMessageId: delivery.messageId,
      brokerOperation: 'retry-discovered-lead',
      campaignId: event?.campaignId,
      className: 'RabbitMqDiscoveredLeadConsumer',
      correlationId: event?.correlationId ?? delivery.correlationId ?? crypto.randomUUID(),
      durationMs: Date.now() - startedAt,
      error: new Error(errorMessage),
      eventId: event?.eventId,
      failureKind,
      input: { retryQueue },
      leadId: event?.lead.leadId,
      method: 'retryOrDeadLetter',
      operation: 'retry-discovered-lead',
      retryable: true,
    });
  }

  private async deadLetter(
    channel: ConfirmChannel,
    message: ConsumeMessage,
    delivery: IInboundBrokerDelivery,
    errorMessage: string,
    event: IDiscoveredLeadEvent | undefined,
    failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND,
    startedAt: number,
  ): Promise<void> {
    channel.sendToQueue(
      QUALIFICATION_DEAD_LETTER_QUEUE,
      message.content,
      createForwardProperties(message, delivery, {
        [FAILURE_KIND_HEADER]: failureKind,
        [FAILURE_MESSAGE_HEADER]: limitFailureMessage(errorMessage),
      }),
    );
    await channel.waitForConfirms();
    channel.ack(message);

    writeQualificationFailureLog({
      attempt: delivery.retryAttempt,
      brokerMessageId: delivery.messageId,
      brokerOperation: 'dead-letter-discovered-lead',
      campaignId: event?.campaignId,
      className: 'RabbitMqDiscoveredLeadConsumer',
      correlationId: event?.correlationId ?? delivery.correlationId ?? crypto.randomUUID(),
      durationMs: Date.now() - startedAt,
      error: new Error(errorMessage),
      eventId: event?.eventId,
      failureKind,
      input: { deadLetterQueue: QUALIFICATION_DEAD_LETTER_QUEUE },
      leadId: event?.lead.leadId,
      method: 'deadLetter',
      operation: 'dead-letter-discovered-lead',
      retryable: false,
    });
  }

  private async closeAfterStartFailure(): Promise<void> {
    if (this.channel !== undefined) {
      await this.channel.close();
    }
    if (this.connection !== undefined) {
      await this.connection.close();
    }
  }

  private logUnexpectedProcessingFailure(
    error: unknown,
    delivery: IInboundBrokerDelivery,
    startedAt: number,
  ): void {
    writeQualificationFailureLog({
      attempt: delivery.retryAttempt,
      brokerMessageId: delivery.messageId,
      brokerOperation: 'process-discovered-lead',
      className: 'RabbitMqDiscoveredLeadConsumer',
      correlationId: delivery.correlationId ?? crypto.randomUUID(),
      durationMs: Date.now() - startedAt,
      error,
      method: 'processDelivery',
      operation: 'qualify-discovered-lead',
      retryable: true,
    });
  }

  private requireChannel(): ConfirmChannel {
    if (this.channel === undefined) {
      throw new Error('RabbitMQ consumer channel is not available');
    }

    return this.channel;
  }
}

function createInboundBrokerDelivery(
  message: ConsumeMessage,
): IInboundBrokerDelivery {
  return {
    body: message.content,
    ...(message.properties.correlationId === undefined
      ? {}
      : { correlationId: message.properties.correlationId }),
    ...(message.properties.messageId === undefined
      ? {}
      : { messageId: message.properties.messageId }),
    retryAttempt: readRetryAttempt(message.properties.headers),
  };
}

function createForwardProperties(
  message: ConsumeMessage,
  delivery: IInboundBrokerDelivery,
  additionalHeaders: Record<string, string | number>,
) {
  return {
    contentType: message.properties.contentType ?? 'application/json',
    correlationId: delivery.correlationId,
    headers: {
      ...message.properties.headers,
      ...additionalHeaders,
    },
    messageId: delivery.messageId,
    persistent: true,
    timestamp: message.properties.timestamp,
    type: message.properties.type,
  };
}

function limitFailureMessage(message: string): string {
  return message.slice(0, MAXIMUM_FAILURE_MESSAGE_LENGTH);
}

function readRetryAttempt(headers: unknown): number {
  if (headers === null || typeof headers !== 'object') {
    return 0;
  }

  const value = new Map(Object.entries(headers)).get(RETRY_ATTEMPT_HEADER);

  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : 0;
}
