import { sanitizeLogInput } from './discovery-structured-logger.js';

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
});
