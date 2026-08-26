import { MemoryDomainError } from './errors.js';

import type { MemoryKind, Ttl } from './types.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function ttlMsForKind(kind: MemoryKind): number {
  switch (kind) {
    case 'working':
      return DAY_MS;
    case 'episode':
      return 30 * DAY_MS;
    case 'identity':
    case 'preference':
    case 'relationship':
    case 'fact':
    case 'procedure':
    case 'constraint':
      return 365 * DAY_MS;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function parseTtl(value: unknown): Ttl | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as { readonly expireAt?: unknown; readonly ttlSeconds?: unknown };
    if (typeof record.expireAt === 'string') {
      return { expireAt: record.expireAt };
    }
    if (typeof record.ttlSeconds === 'number') {
      return { ttlSeconds: record.ttlSeconds };
    }
  }
  throw new MemoryDomainError('invalid_input', 'ttl must include expireAt or ttlSeconds');
}

export function resolveExpireAt(kind: MemoryKind, now: Date, ttl?: Ttl): string {
  const maxAtMs = now.getTime() + ttlMsForKind(kind);
  const expireAtMs = expireAtMsFromTtl(now, ttl, ttlMsForKind(kind));
  if (Number.isNaN(expireAtMs)) {
    throw new MemoryDomainError('invalid_input', 'expireAt must be an ISO-8601 timestamp');
  }
  if (expireAtMs <= now.getTime()) {
    throw new MemoryDomainError('invalid_input', 'expireAt must be in the future');
  }
  return new Date(Math.min(expireAtMs, maxAtMs)).toISOString();
}

export function isExpired(expireAt: string | undefined, now: Date): boolean {
  if (expireAt === undefined) {
    return false;
  }
  const parsed = Date.parse(expireAt);
  if (Number.isNaN(parsed)) {
    return true;
  }
  return parsed <= now.getTime();
}

function expireAtMsFromTtl(now: Date, ttl: Ttl | undefined, defaultMs: number): number {
  if (ttl !== undefined && 'expireAt' in ttl) {
    return Date.parse(ttl.expireAt);
  }
  if (ttl !== undefined && 'ttlSeconds' in ttl) {
    if (!Number.isFinite(ttl.ttlSeconds) || ttl.ttlSeconds <= 0) {
      throw new MemoryDomainError('invalid_input', 'ttlSeconds must be a positive number');
    }
    return now.getTime() + ttl.ttlSeconds * 1000;
  }
  return now.getTime() + defaultMs;
}
