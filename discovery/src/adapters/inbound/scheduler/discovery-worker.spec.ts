import { jest } from '@jest/globals';

import {
  DiscoveryWorkError,
  IAdvanceDiscoveryWorkInput,
  IAdvanceDiscoveryWorkResult,
  IDiscoveryWorkUseCase,
} from '../../../app/discovery/discovery-progress.service.js';
import { DISCOVERY_SOURCE_KIND } from '../../../domain/discovery/discovery-model.js';
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
});

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
