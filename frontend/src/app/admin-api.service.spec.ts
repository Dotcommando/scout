import { TestBed } from '@angular/core/testing';

import {
  AdminApiService,
  DISCOVERY_RUN_STATUS,
  parseDiscoveryRun,
} from './admin-api.service';

describe('AdminApiService Discovery runs', () => {
  let service: AdminApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AdminApiService);
  });

  for (const status of Object.values(DISCOVERY_RUN_STATUS)) {
    it('parses the ' + status + ' status', () => {
      const run = parseDiscoveryRun({
        campaignId: 'campaign-a',
        runId: 'run-a',
        status,
      });

      expect(run.status).toBe(status);
    });
  }

  it('rejects an unsupported run status', () => {
    expect(() => parseDiscoveryRun({
      campaignId: 'campaign-a',
      runId: 'run-a',
      status: 'unknown',
    })).toThrowError('status must be a supported Discovery run status');
  });

  it('returns a typed POST run resource', async () => {
    spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse({
      campaignId: 'campaign-a',
      runId: 'run-a',
      status: DISCOVERY_RUN_STATUS.ACCEPTED,
    }, 202));

    const run = await service.runDiscovery('campaign-a', 10);

    expect(run.runId).toBe('run-a');
    expect(run.status).toBe(DISCOVERY_RUN_STATUS.ACCEPTED);
  });

  it('normalizes an owner error when polling a run', async () => {
    spyOn(globalThis, 'fetch').and.resolveTo(jsonResponse({ message: 'Run was not found' }, 404));

    await expectAsync(service.getDiscoveryRun('missing-run'))
      .toBeRejectedWithError('Run was not found');
  });
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}
