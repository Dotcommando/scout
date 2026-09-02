import { createHash } from 'node:crypto';

export function createStableIdentifier(prefix: string, ...parts: readonly string[]): string {
  const hash = createHash('sha256').update(parts.join('\u0000')).digest('hex');

  return `${prefix}-${hash}`;
}
