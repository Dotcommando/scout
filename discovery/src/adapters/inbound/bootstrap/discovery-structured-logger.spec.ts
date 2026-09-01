import {
  sanitizeLogInput,
  serializeDiscoveryLogEntry,
} from './discovery-structured-logger.js';

describe('sanitizeLogInput', () => {
  it('redacts nested secret fields', () => {
    expect(
      sanitizeLogInput({
        nested: {
          authorization: 'secret',
        },
        token: 'secret',
      }),
    ).toEqual({
      nested: {
        authorization: '[REDACTED]',
      },
      token: '[REDACTED]',
    });
  });

  it('preserves actionable operation context while redacting secrets', () => {
    const serialized = serializeDiscoveryLogEntry({
      attempt: 2,
      campaignId: 'campaign-a',
      className: 'DiscoveryWorker',
      correlationId: 'correlation-a',
      error: {
        message: 'provider rejected the request',
        name: 'DiscoveryWorkError',
        stack: 'stack',
      },
      input: {
        providerRunId: 'run-a',
        token: 'secret',
      },
      level: 'error',
      method: 'triggerWork',
      operation: 'advance-discovery-work',
      providerRunId: 'run-a',
      retryable: false,
      service: 'discovery',
      sourceKind: 'google-maps',
      scopeId: 'GB',
    });

    expect(serialized).toContain('"campaignId":"campaign-a"');
    expect(serialized).toContain('"providerRunId":"run-a"');
    expect(serialized).toContain('"token":"[REDACTED]"');
    expect(serialized).not.toContain('"token":"secret"');
  });
});
