import { isMemoryDomainError } from '@mnem-steward/core';

export function domainErrorStatus(error: unknown): 400 | 401 | 403 | 404 | 500 | 503 {
  if (!isMemoryDomainError(error)) {
    return 500;
  }
  switch (error.code) {
    case 'unauthenticated':
      return 401;
    case 'invalid_input':
      return 400;
    case 'not_found':
      return 404;
    case 'unavailable':
      return 503;
    case 'forbidden':
    case 'namespace_denied':
    case 'secret_detected':
    case 'prohibited_classification':
      return 403;
    default: {
      const exhaustive: never = error.code;
      return exhaustive;
    }
  }
}
