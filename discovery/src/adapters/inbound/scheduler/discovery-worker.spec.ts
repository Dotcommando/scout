import { jest } from '@jest/globals';

import {
  DISCOVERY_WORK_OUTCOME,
  DiscoveryWorkError,
  IAdvanceDiscoveryWorkInput,
  IAdvanceDiscoveryWorkResult,
  IDiscoveryWorkUseCase,
} from '../../../app/discovery/discovery-progress.service.js';
import { DISCOVERY_SOURCE_KIND } from '../../../domain/discovery/discovery-model.js';
import {
  DISCOVERY_OPERATION_RUN_STATUS,
  DISCOVERY_OPERATION_RUN_TRIGGER,
  IDiscoveryOperationRun,
  IDiscoveryOperationRunPage,
  IDiscoveryOperationRunRepositoryPort,
} from '../../../ports/outbound/discovery-operation-run-repository.port.js';
import { DiscoveryWorker } from './discovery-worker.js';

describe('DiscoveryWorker', () => {
  it('writes structured contextual diagnostics for a failed worker operation', async () => {
    const worker = new DiscoveryWorker(new FailingDiscoveryWorkUseCase());
    const stderrWrite = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    await expect(worker.triggerWork()).rejects.toThrow('Discovery work failed');

    const firstWrite = stderrWrite.mock.calls[0]?.[0];

    if (typeof firstWrite !== 'string') {
      throw new Error('expected a JSON error log line');
    }

    expect(firstWrite).toContain('"campaignId":"campaign-a"');
    expect(firstWrite).toContain('"scopeId":"GB"');
    expect(firstWrite).toContain('"providerRunId":"run-a"');
    expect(firstWrite).toContain('"retryable":false');

    stderrWrite.mockRestore();
  });

  it('completes coalesced active runs after later terminal work', async () => {
    const repository = new InMemoryOperationRunRepository([
      createOperationRun('run-1'),
      createOperationRun('run-2'),
    ]);
    const worker = new DiscoveryWorker(
      new ScriptedDiscoveryWorkUseCase([
        DISCOVERY_WORK_OUTCOME.PROVIDER_RUN_PENDING,
        DISCOVERY_WORK_OUTCOME.IMPORT_COMPLETED,
      ]),
      repository,
    );

    await worker.triggerWork();
    expect(repository.getRunStatus('run-1')).toBe(DISCOVERY_OPERATION_RUN_STATUS.RUNNING);
    expect(repository.getRunStatus('run-2')).toBe(DISCOVERY_OPERATION_RUN_STATUS.ACCEPTED);

    await worker.triggerWork();
    expect(repository.getRunStatus('run-1')).toBe(DISCOVERY_OPERATION_RUN_STATUS.COMPLETED);
    expect(repository.getRunStatus('run-2')).toBe(DISCOVERY_OPERATION_RUN_STATUS.COMPLETED);
    expect(repository.claimedRunCount).toBe(1);
  });
});

class InMemoryOperationRunRepository implements IDiscoveryOperationRunRepositoryPort {
  public claimedRunCount = 0;

  public constructor(private runs: IDiscoveryOperationRun[]) {}

  public async claimNextAcceptedRun(claimedAt: Date): Promise<IDiscoveryOperationRun | undefined> {
    const index = this.runs.findIndex((run) => run.status === DISCOVERY_OPERATION_RUN_STATUS.ACCEPTED);

    if (index < 0) {
      return undefined;
    }

    const run = this.runs[index];

    if (run === undefined) {
      return undefined;
    }

    const claimed = { ...run, status: DISCOVERY_OPERATION_RUN_STATUS.RUNNING, updatedAt: claimedAt };

    this.runs[index] = claimed;
    this.claimedRunCount += 1;

    return claimed;
  }

  public async findByIdempotencyKey(): Promise<IDiscoveryOperationRun | undefined> {
    return undefined;
  }

  public async findOldestRunningRun(): Promise<IDiscoveryOperationRun | undefined> {
    return this.runs.find((run) => run.status === DISCOVERY_OPERATION_RUN_STATUS.RUNNING);
  }

  public async findRun(runId: string): Promise<IDiscoveryOperationRun | undefined> {
    return this.runs.find((run) => run.runId === runId);
  }

  public async finishActiveCampaignRuns(
    campaignId: string,
    status: DISCOVERY_OPERATION_RUN_STATUS,
    updatedAt: Date,
  ): Promise<void> {
    this.runs = this.runs.map((run) => run.campaignId !== campaignId
      || (run.status !== DISCOVERY_OPERATION_RUN_STATUS.ACCEPTED
        && run.status !== DISCOVERY_OPERATION_RUN_STATUS.RUNNING)
      ? run
      : { ...run, status, updatedAt });
  }

  public getRunStatus(runId: string): DISCOVERY_OPERATION_RUN_STATUS | undefined {
    return this.runs.find((run) => run.runId === runId)?.status;
  }

  public async listRuns(): Promise<IDiscoveryOperationRunPage> {
    return { items: this.runs, total: this.runs.length };
  }

  public async saveRun(run: IDiscoveryOperationRun): Promise<void> {
    this.runs.push(run);
  }

  public async updateRunStatus(): Promise<void> {}
}

class FailingDiscoveryWorkUseCase implements IDiscoveryWorkUseCase {
  public async advanceDiscoveryWork(
    input: IAdvanceDiscoveryWorkInput,
  ): Promise<IAdvanceDiscoveryWorkResult> {
    throw new DiscoveryWorkError(
      {
        attempt: 2,
        campaignId: 'campaign-a',
        providerRunId: 'run-a',
        scopeId: 'GB',
        sourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
      },
      false,
      new Error(`provider rejected ${input.correlationId}`),
    );
  }
}

class ScriptedDiscoveryWorkUseCase implements IDiscoveryWorkUseCase {
  public constructor(private readonly outcomes: DISCOVERY_WORK_OUTCOME[]) {}

  public async advanceDiscoveryWork(): Promise<IAdvanceDiscoveryWorkResult> {
    const outcome = this.outcomes.shift();

    if (outcome === undefined) {
      throw new Error('no Discovery work outcome was configured');
    }

    return { outcome, scopeId: 'GB' };
  }
}

function createOperationRun(runId: string): IDiscoveryOperationRun {
  const createdAt = new Date('2026-09-03T00:00:00.000Z');

  return {
    campaignId: 'campaign-a',
    configurationHash: 'hash-a',
    correlationId: 'correlation-a',
    createdAt,
    idempotencyKey: 'key-' + runId,
    maximumProviderItems: 10,
    runId,
    status: DISCOVERY_OPERATION_RUN_STATUS.ACCEPTED,
    trigger: DISCOVERY_OPERATION_RUN_TRIGGER.MANUAL,
    updatedAt: createdAt,
  };
}
