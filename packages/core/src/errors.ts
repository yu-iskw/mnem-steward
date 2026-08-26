import type { DomainErrorCode } from './types.js';

export class MemoryDomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'MemoryDomainError';
    this.code = code;
  }
}

export function isMemoryDomainError(error: unknown): error is MemoryDomainError {
  return error instanceof MemoryDomainError;
}
