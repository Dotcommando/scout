import { randomUUID } from 'node:crypto';

import {
  DISCOVERED_LEAD_EVENT_TYPE,
  DISCOVERED_LEAD_SCHEMA_VERSION,
} from '@scout/contracts';
import { connect } from 'amqplib';

import { DiscoveryRuntimeConfiguration } from '../../src/adapters/inbound/bootstrap/discovery-runtime-configuration.js';
import { RabbitMqDiscoveredLeadMessagePublisher } from '../../src/adapters/outbound/rabbitmq/rabbitmq-discovered-lead-message-publisher.js';
import { DiscoveryMessagePublicationError } from '../../src/app/discovery/discovery-output-publisher.service.js';

const DISCOVERED_LEAD_EXCHANGE = 'discovery.lead.v1';
const DISCOVERED_LEAD_ROUTING_KEY = 'lead.discovered.v1';

describe('RabbitMqDiscoveredLeadMessagePublisher', () => {
  it('classifies mandatory-routing failures when no queue is bound', async () => {
    const publisher = new RabbitMqDiscoveredLeadMessagePublisher(
      new DiscoveryRuntimeConfiguration(),
    );

    await expect(
      publisher.publishDiscoveredLead(createDiscoveredLeadEvent()),
    ).rejects.toMatchObject({
      kind: 'mandatory-routing',
      retryable: true,
    } satisfies Partial<DiscoveryMessagePublicationError>);
  });

  it('routes a persistent, confirmed discovered-lead event', async () => {
    const configuration = new DiscoveryRuntimeConfiguration();
    const connection = await connect(configuration.rabbitmqUri);
    const channel = await connection.createChannel();
    const queueName = `discovery-publisher-test-${randomUUID()}`;

    try {
      await channel.assertExchange(DISCOVERED_LEAD_EXCHANGE, 'topic', {
        durable: true,
      });
      await channel.assertQueue(queueName, { durable: false });
      await channel.bindQueue(
        queueName,
        DISCOVERED_LEAD_EXCHANGE,
        DISCOVERED_LEAD_ROUTING_KEY,
      );

      const publisher = new RabbitMqDiscoveredLeadMessagePublisher(configuration);

      await publisher.publishDiscoveredLead(createDiscoveredLeadEvent());

      const message = await channel.get(queueName, { noAck: true });

      expect(message).not.toBe(false);

      if (message === false) {
        throw new Error('expected RabbitMQ message');
      }
      expect(message.properties.deliveryMode).toBe(2);
      expect(message.properties.messageId).toBe('event-1');
      expect(JSON.parse(message.content.toString())).toMatchObject({
        eventId: 'event-1',
        eventType: DISCOVERED_LEAD_EVENT_TYPE.DISCOVERED_LEAD,
      });
    } finally {
      await channel.deleteQueue(queueName);
      await channel.close();
      await connection.close();
    }
  });
});

function createDiscoveredLeadEvent() {
  return {
    campaignId: 'campaign-1',
    correlationId: 'correlation-1',
    eventId: 'event-1',
    eventType: DISCOVERED_LEAD_EVENT_TYPE.DISCOVERED_LEAD,
    lead: {
      externalId: 'external-1',
      leadId: 'lead-1',
      name: 'Example lead',
      sourceKind: 'google-maps',
    },
    occurredAt: '2026-09-02T12:00:00.000Z',
    schemaVersion: DISCOVERED_LEAD_SCHEMA_VERSION.V1,
  };
}
