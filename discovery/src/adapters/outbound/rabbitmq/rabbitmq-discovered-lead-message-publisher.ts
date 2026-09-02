import { Injectable } from '@nestjs/common';
import { IDiscoveredLeadEvent, serializeDiscoveredLeadEvent } from '@scout/contracts';
import { ConfirmChannel, connect, Message } from 'amqplib';

import {
  DiscoveryMessagePublicationError,
} from '../../../app/discovery/discovery-output-publisher.service.js';
import {
  IDiscoveredLeadMessagePublisherPort,
} from '../../../ports/outbound/discovered-lead-message-publisher.port.js';
import {
  DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND,
} from '../../../ports/outbound/discovery-output-repository.port.js';
import { DiscoveryRuntimeConfiguration } from '../../inbound/bootstrap/discovery-runtime-configuration.js';

const DISCOVERED_LEAD_EXCHANGE = 'discovery.lead.v1';
const DISCOVERED_LEAD_ROUTING_KEY = 'lead.discovered.v1';

@Injectable()
export class RabbitMqDiscoveredLeadMessagePublisher
  implements IDiscoveredLeadMessagePublisherPort {
  public constructor(
    private readonly runtimeConfiguration: DiscoveryRuntimeConfiguration,
  ) {}

  public async publishDiscoveredLead(event: IDiscoveredLeadEvent): Promise<void> {
    const serializedEvent = this.serializeEvent(event);
    let connection: Awaited<ReturnType<typeof connect>> | undefined;

    try {
      connection = await connect(this.runtimeConfiguration.rabbitmqUri);
      connection.on('error', () => undefined);
      const channel = await connection.createConfirmChannel();

      channel.on('error', () => undefined);
      await channel.assertExchange(DISCOVERED_LEAD_EXCHANGE, 'topic', {
        durable: true,
      });
      await publishWithConfirm(channel, serializedEvent, event);
      await connection.close();
    } catch (error: unknown) {
      if (connection !== undefined) {
        await closeConnectionAfterFailure(connection);
      }
      if (error instanceof DiscoveryMessagePublicationError) {
        throw error;
      }

      throw new DiscoveryMessagePublicationError(
        DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND.CONNECTION,
        true,
        'RabbitMQ publication connection or confirmation failed',
        error,
      );
    }
  }

  private serializeEvent(event: IDiscoveredLeadEvent): Buffer {
    try {
      return Buffer.from(serializeDiscoveredLeadEvent(event));
    } catch (error: unknown) {
      throw new DiscoveryMessagePublicationError(
        DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND.INVALID_PAYLOAD,
        false,
        'Discovered lead event does not match the public transport contract',
        error,
      );
    }
  }
}

async function closeConnectionAfterFailure(
  connection: Awaited<ReturnType<typeof connect>>,
): Promise<void> {
  try {
    await connection.close();
  } catch {
    return;
  }
}

async function publishWithConfirm(
  channel: ConfirmChannel,
  serializedEvent: Buffer,
  event: IDiscoveredLeadEvent,
): Promise<void> {
  let returnedMessage: Message | undefined;
  const recordReturnedMessage = (message: Message): void => {
    returnedMessage = message;
  };

  channel.on('return', recordReturnedMessage);

  try {
    channel.publish(
      DISCOVERED_LEAD_EXCHANGE,
      DISCOVERED_LEAD_ROUTING_KEY,
      serializedEvent,
      {
        contentType: 'application/json',
        correlationId: event.correlationId,
        mandatory: true,
        messageId: event.eventId,
        persistent: true,
        timestamp: Math.floor(Date.parse(event.occurredAt) / 1000),
        type: event.eventType,
      },
    );
    await channel.waitForConfirms();
  } catch (error: unknown) {
    throw new DiscoveryMessagePublicationError(
      DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND.CONFIRMATION,
      true,
      'RabbitMQ did not confirm discovered lead publication',
      error,
    );
  } finally {
    channel.removeListener('return', recordReturnedMessage);
    await channel.close();
  }

  if (returnedMessage !== undefined) {
    throw new DiscoveryMessagePublicationError(
      DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND.MANDATORY_ROUTING,
      true,
      `RabbitMQ returned unroutable discovered lead event ${event.eventId}`,
    );
  }
}
