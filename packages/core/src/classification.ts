import { MemoryDomainError } from './errors.js';

import type { Classification } from './types.js';

const CLASSIFICATIONS: readonly Classification[] = [
  'public',
  'internal',
  'confidential',
  'restricted',
  'prohibited-for-memory',
];

export function tryParseClassification(value: string): Classification | undefined {
  return CLASSIFICATIONS.find((item) => item === value);
}

export function parseClassification(value: string): Classification {
  const match = tryParseClassification(value);
  if (match === undefined) {
    throw new MemoryDomainError('invalid_input', `Unknown classification: ${value}`);
  }
  return match;
}

export function assertPersistableClassification(classification: Classification): void {
  switch (classification) {
    case 'prohibited-for-memory':
      throw new MemoryDomainError(
        'prohibited_classification',
        'Classification prohibited-for-memory cannot be persisted',
      );
    case 'public':
    case 'internal':
    case 'confidential':
    case 'restricted':
      return;
    default: {
      const exhaustive: never = classification;
      return exhaustive;
    }
  }
}
