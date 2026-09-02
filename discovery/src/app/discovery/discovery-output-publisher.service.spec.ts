import { jest } from '@jest/globals';

import { DISCOVERY_SOURCE_KIND } from '../../domain/discovery/discovery-model.js';
import { IClockPort } from '../../ports/outbound/clock.port.js';
import { IDiscoveredLeadMessagePublisherPort } from '../../ports/outbound/discovered-lead-message-publisher.port.js';
import {
  DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND,
  IClaimedDiscoveryOutput,
  IClaimPendingDiscoveryOutputsInput,
  IConfirmDiscoveryOutputPublicationInput,
  IDiscoveryOutputRepositoryPort,
  IRecordDiscoveryOutputPublicationFailureInput,
  IReleaseDiscoveryOutputClaimInput,
  ISaveDiscoveryOutputInput,
} from '../../ports/outbound/discovery-output-repository.port.js';
import {
  DiscoveryMessagePublicationError,
  DiscoveryOutputPublisherService,
  DiscoveryOutputPublishingError,
} from './discovery-output-publisher.service.js';

const CURRENT_TIME = new Date('2026-09-02T12:00:00.000Z');

describe('DiscoveryOutputPublisherService', () => {
  it('marks an output published only after the publisher confirms it', async () => {
    const repository = new FakeDiscoveryOutputRepository([createOutput()]);
    const publisher = new FakeDiscoveredLeadPublisher();
    const service = new DiscoveryOutputPublisherService(
      new FakeClock(CURRENT_TIME),
      repository,
      publisher,
    );
    const result = await service.publishPendingDiscoveryOutputs(createInput());

    expect(result).toEqual({
      claimedOutputCount: 1,
      confirmedOutputCount: 1,
      retryScheduledOutputs: [],
      retryScheduledOutputCount: 0,
    });
    expect(publisher.publishDiscoveredLead).toHaveBeenCalledTimes(1);
    expect(repository.confirmations).toHaveLength(1);
    expect(repository.failures).toHaveLength(0);
  });

  it('retains a transient broker failure as a retryable pending output', async () => {
    const repository = new FakeDiscoveryOutputRepository([createOutput()]);
    const publisher = new FakeDiscoveredLeadPublisher(
      new DiscoveryMessagePublicationError(
        DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND.CONNECTION,
        true,
        'broker unavailable',
      ),
    );
    const service = new DiscoveryOutputPublisherService(
      new FakeClock(CURRENT_TIME),
      repository,
      publisher,
    );
    const result = await service.publishPendingDiscoveryOutputs(createInput());

    expect(result.retryScheduledOutputCount).toBe(1);
    expect(repository.confirmations).toHaveLength(0);
    expect(repository.failures[0]?.failure).toEqual({
      kind: DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND.CONNECTION,
      message: 'broker unavailable',
      occurredAt: CURRENT_TIME,
      retryable: true,
    });
    expect(repository.failures[0]?.nextAttemptAt).toEqual(
      new Date('2026-09-02T12:00:30.000Z'),
    );
  });

  it('leaves a broker-confirmed output recoverable when confirmation persistence is lost', async () => {
    const repository = new FakeDiscoveryOutputRepository([createOutput()]);

    repository.confirmationResult = false;
    const service = new DiscoveryOutputPublisherService(
      new FakeClock(CURRENT_TIME),
      repository,
      new FakeDiscoveredLeadPublisher(),
    );

    await expect(service.publishPendingDiscoveryOutputs(createInput())).rejects.toThrow(
      DiscoveryOutputPublishingError,
    );

    expect(repository.failures).toHaveLength(0);
  });
});

class FakeClock implements IClockPort {
  public constructor(private readonly currentTime: Date) {}

  public getCurrentTime(): Date {
    return this.currentTime;
  }
}

class FakeDiscoveredLeadPublisher implements IDiscoveredLeadMessagePublisherPort {
  public readonly publishDiscoveredLead = jest.fn(async (): Promise<void> => {
    if (this.error !== undefined) {
      throw this.error;
    }
  });

  public constructor(private readonly error?: Error) {}
}

class FakeDiscoveryOutputRepository implements IDiscoveryOutputRepositoryPort {
  public readonly confirmations: IConfirmDiscoveryOutputPublicationInput[] = [];
  public readonly failures: IRecordDiscoveryOutputPublicationFailureInput[] = [];
  public confirmationResult = true;

  public constructor(private readonly outputs: readonly IClaimedDiscoveryOutput[]) {}

  public async claimPendingDiscoveryOutputs(
    input: IClaimPendingDiscoveryOutputsInput,
  ): Promise<readonly IClaimedDiscoveryOutput[]> {
    void input;

    return this.outputs;
  }

  public async confirmDiscoveryOutputPublication(
    input: IConfirmDiscoveryOutputPublicationInput,
  ): Promise<boolean> {
    this.confirmations.push(input);

    return this.confirmationResult;
  }

  public async recordDiscoveryOutputPublicationFailure(
    input: IRecordDiscoveryOutputPublicationFailureInput,
  ): Promise<boolean> {
    this.failures.push(input);

    return true;
  }

  public async releaseDiscoveryOutputClaim(
    input: IReleaseDiscoveryOutputClaimInput,
  ): Promise<boolean> {
    void input;

    return true;
  }

  public async saveDiscoveryOutput(input: ISaveDiscoveryOutputInput): Promise<void> {
    void input;
  }
}

function createInput() {
  return {
    batchSize: 10,
    correlationId: 'correlation-1',
    retryDelayMilliseconds: 30_000,
    retryMaximumAttempts: 3,
    workerId: 'worker-1',
  };
}

function createOutput(): IClaimedDiscoveryOutput {
  return {
    campaignId: 'campaign-1',
    leadId: 'lead-1',
    outputId: 'output-1',
    payload: {
      campaignId: 'campaign-1',
      correlationId: 'correlation-1',
      eventId: 'output-1',
      lead: {
        externalId: 'external-1',
        leadId: 'lead-1',
        name: 'Example lead',
        sourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
      },
      occurredAt: CURRENT_TIME,
      schemaVersion: 1,
    },
    publishAttemptCount: 1,
  };
}
