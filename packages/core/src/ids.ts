import { createHash, randomUUID } from 'node:crypto';

import { MemoryDomainError } from './errors.js';

import type { MemoryId, PrincipalId } from './types.js';

const SAFE_MEMORY_ID = /^[A-Za-z0-9_-]{1,128}$/u;

export function principalIdFromOidc(issuer: string, sub: string): PrincipalId {
  const digest = createHash('sha256').update(`${issuer}\n${sub}`).digest('hex').slice(0, 24);
  return `usr_${digest}`;
}

export function createMemoryId(): MemoryId {
  return `mem_${randomUUID().replaceAll('-', '')}`;
}

export function assertMemoryId(id: string): MemoryId {
  if (!SAFE_MEMORY_ID.test(id)) {
    throw new MemoryDomainError('invalid_input', 'Invalid memory id');
  }
  return id;
}

export type IdGenerator = {
  nextMemoryId(): MemoryId;
  nextRevisionId(): string;
};

export function createRandomIdGenerator(): IdGenerator {
  return {
    nextMemoryId: createMemoryId,
    nextRevisionId(): string {
      return `rev_${randomUUID().replaceAll('-', '')}`;
    },
  };
}

export function createSequenceIdGenerator(prefix = 'test'): IdGenerator {
  let memorySeq = 0;
  let revisionSeq = 0;
  return {
    nextMemoryId(): MemoryId {
      memorySeq += 1;
      return `mem_${prefix}_${String(memorySeq).padStart(4, '0')}`;
    },
    nextRevisionId(): string {
      revisionSeq += 1;
      return `rev_${prefix}_${String(revisionSeq).padStart(4, '0')}`;
    },
  };
}
