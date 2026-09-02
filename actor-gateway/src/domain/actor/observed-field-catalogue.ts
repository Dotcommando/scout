import { IObservedActorField } from '../../ports/outbound/actor-request-repository.port.js';

interface IObservedFieldAccumulator {
  readonly nonNullRecordIndexes: Set<number>;
  readonly presentRecordIndexes: Set<number>;
  readonly valueKinds: Set<string>;
}

export function buildObservedFieldCatalogue(
  actorDefinitionId: string,
  actorRevision: string,
  archiveId: string,
  observedAt: string,
  records: readonly unknown[],
): readonly IObservedActorField[] {
  const fields = new Map<string, IObservedFieldAccumulator>();

  records.forEach((record, index) => observeValue(fields, '', record, index));

  return [...fields.entries()].map(([key, value]) => {
    const [recordKind, jsonPointer] = key.split('\u0000');

    return {
      actorDefinitionId,
      actorRevision,
      firstObservedArchiveId: archiveId,
      jsonPointer,
      lastObservedArchiveId: archiveId,
      lastObservedAt: observedAt,
      nonNullRecordCount: value.nonNullRecordIndexes.size,
      observedValueKinds: [...value.valueKinds].sort(),
      presentRecordCount: value.presentRecordIndexes.size,
      recordKind,
    };
  });
}

function observeValue(
  fields: Map<string, IObservedFieldAccumulator>,
  pointer: string,
  value: unknown,
  recordIndex: number,
): void {
  const recordKind = readRecordKind(value);
  const key = `${recordKind}\u0000${pointer}`;
  const accumulator = fields.get(key) ?? createAccumulator();

  accumulator.presentRecordIndexes.add(recordIndex);
  accumulator.valueKinds.add(readValueKind(value));

  if (value !== null) {
    accumulator.nonNullRecordIndexes.add(recordIndex);
  }
  fields.set(key, accumulator);

  if (Array.isArray(value)) {
    value.forEach((item) => observeValue(
      fields,
      `${pointer}/${recordIndex === -1 ? '-' : '*'}`,
      item,
      recordIndex,
    ));

    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([name, nestedValue]) => observeValue(
      fields,
      `${pointer}/${escapeJsonPointerToken(name)}`,
      nestedValue,
      recordIndex,
    ));
  }
}

function createAccumulator(): IObservedFieldAccumulator {
  return {
    nonNullRecordIndexes: new Set<number>(),
    presentRecordIndexes: new Set<number>(),
    valueKinds: new Set<string>(),
  };
}

function escapeJsonPointerToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readRecordKind(value: unknown): string {
  if (!isRecord(value) || typeof value.type !== 'string' || value.type.length === 0) {
    return 'unknown';
  }

  return value.type;
}

function readValueKind(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}
