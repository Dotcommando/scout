import {
  DISCOVERED_LEAD_EVENT_TYPE,
  DISCOVERED_LEAD_SCHEMA_VERSION,
} from '@scout/contracts';

import {
  IQualifyLeadInput,
  IQualifyLeadResult,
  IQualifyLeadUseCase,
  QUALIFY_LEAD_OUTCOME,
} from '../../../ports/inbound/qualify-lead.use-case.js';
import { QualificationProfileConfigurationValidationError } from '../configuration/qualification-profile-configuration.js';
import {
  QUALIFICATION_MESSAGE_FAILURE_KIND,
  QUALIFICATION_MESSAGE_HANDLING_OUTCOME,
  RabbitMqDiscoveredLeadMessageHandler,
} from './rabbitmq-discovered-lead-message-handler.js';

describe('RabbitMqDiscoveredLeadMessageHandler', () => {
  it('rejects malformed contract payloads before application processing', async () => {
    const useCase = new FakeQualifyLeadUseCase();
    const handler = new RabbitMqDiscoveredLeadMessageHandler(useCase);
    const result = await handler.handleDelivery({
      body: Buffer.from('{invalid'),
      correlationId: 'correlation-1',
      messageId: 'event-1',
      retryAttempt: 0,
    }, 'worker-1');

    expect(result).toMatchObject({
      failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND.INVALID_CONTRACT,
      outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.DEAD_LETTER,
    });
    expect(useCase.inputs).toHaveLength(0);
  });

  it('finishes durable qualification before reporting a delivery as processed', async () => {
    const useCase = new FakeQualifyLeadUseCase();
    const handler = new RabbitMqDiscoveredLeadMessageHandler(useCase);
    const result = await handler.handleDelivery(createDelivery(), 'worker-1');

    expect(useCase.processingCompleted).toBe(true);
    expect(result.outcome).toBe(QUALIFICATION_MESSAGE_HANDLING_OUTCOME.PROCESSED);
  });

  it('treats an already-completed duplicate delivery as processed', async () => {
    const useCase = new FakeQualifyLeadUseCase();

    useCase.returnAlreadyCompletedAfterFirstDelivery = true;
    const handler = new RabbitMqDiscoveredLeadMessageHandler(useCase);
    const first = await handler.handleDelivery(createDelivery(), 'worker-1');
    const duplicate = await handler.handleDelivery(createDelivery(), 'worker-1');

    expect(first.outcome).toBe(QUALIFICATION_MESSAGE_HANDLING_OUTCOME.PROCESSED);
    expect(duplicate).toMatchObject({
      outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.PROCESSED,
      qualification: {
        outcome: QUALIFY_LEAD_OUTCOME.ALREADY_COMPLETED,
      },
    });
  });

  it('defers an active execution instead of treating it as acknowledged work', async () => {
    const useCase = new FakeQualifyLeadUseCase();

    useCase.returnInProgress = true;
    const handler = new RabbitMqDiscoveredLeadMessageHandler(useCase);
    const result = await handler.handleDelivery(createDelivery(), 'worker-1');

    expect(result).toMatchObject({
      failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND.TRANSIENT_PROCESSING,
      outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.RETRY,
    });
  });

  it('classifies transient application failures for bounded retry', async () => {
    const useCase = new FakeQualifyLeadUseCase();

    useCase.failure = new Error('MongoDB unavailable');
    const handler = new RabbitMqDiscoveredLeadMessageHandler(useCase);
    const result = await handler.handleDelivery(createDelivery(), 'worker-1');

    expect(result).toMatchObject({
      failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND.TRANSIENT_PROCESSING,
      outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.RETRY,
    });
  });

  it('classifies an unsupported campaign profile as terminal input', async () => {
    const useCase = new FakeQualifyLeadUseCase();

    useCase.failure = new QualificationProfileConfigurationValidationError(
      '/config/profiles.yaml',
      'profiles',
      'does not define a profile for campaignId campaign-1',
    );
    const handler = new RabbitMqDiscoveredLeadMessageHandler(useCase);
    const result = await handler.handleDelivery(createDelivery(), 'worker-1');

    expect(result).toMatchObject({
      failureKind: QUALIFICATION_MESSAGE_FAILURE_KIND.PERMANENT_INPUT,
      outcome: QUALIFICATION_MESSAGE_HANDLING_OUTCOME.DEAD_LETTER,
    });
  });
});

class FakeQualifyLeadUseCase implements IQualifyLeadUseCase {
  public failure: Error | undefined;
  public readonly inputs: IQualifyLeadInput[] = [];
  public processingCompleted = false;
  public returnAlreadyCompletedAfterFirstDelivery = false;
  public returnInProgress = false;

  public async qualifyLead(input: IQualifyLeadInput): Promise<IQualifyLeadResult> {
    this.inputs.push(input);

    if (this.failure !== undefined) {
      throw this.failure;
    }

    this.processingCompleted = true;

    return {
      outcome: this.returnInProgress
        ? QUALIFY_LEAD_OUTCOME.IN_PROGRESS
        : this.returnAlreadyCompletedAfterFirstDelivery
          && this.inputs.length > 1
          ? QUALIFY_LEAD_OUTCOME.ALREADY_COMPLETED
          : QUALIFY_LEAD_OUTCOME.COMPLETED,
      profileVersion: 1,
    };
  }
}

function createDelivery() {
  return {
    body: Buffer.from(JSON.stringify({
      campaignId: 'campaign-1',
      correlationId: 'correlation-1',
      eventId: 'event-1',
      eventType: DISCOVERED_LEAD_EVENT_TYPE.DISCOVERED_LEAD,
      lead: {
        externalId: 'external-1',
        leadId: 'lead-1',
        name: 'Example lead',
        sourceKind: 'directory',
      },
      occurredAt: '2026-09-02T12:00:00.000Z',
      schemaVersion: DISCOVERED_LEAD_SCHEMA_VERSION.V1,
    })),
    correlationId: 'correlation-1',
    messageId: 'event-1',
    retryAttempt: 0,
  };
}
