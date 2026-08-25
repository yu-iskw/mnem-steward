import { MemoryDomainError, parseMemoryContext, parseMemoryKind } from '@mnem-steward/core';

import type { MemoryKind } from '@mnem-steward/core';

export { parseMemoryContext as parseContext };

export function asObject(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new MemoryDomainError('invalid_input', 'Request body must be an object');
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MemoryDomainError('invalid_input', `Missing ${field}`);
  }
  return value;
}

export function optionalKind(value: unknown): MemoryKind | undefined {
  return typeof value === 'string' ? parseMemoryKind(value) : undefined;
}

export async function readJson(context: {
  req: { json: () => Promise<unknown> };
}): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new MemoryDomainError('invalid_input', 'Invalid JSON body');
  }
}
