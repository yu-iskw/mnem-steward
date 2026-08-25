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

export function resolveExpireAt(kind: MemoryKind, now: Date, ttl?: Ttl): string {
  if (ttl !== undefined && 'expireAt' in ttl) {
    return ttl.expireAt;
  }
  const durationMs = ttl !== undefined && 'ttlSeconds' in ttl ? ttl.ttlSeconds * 1000 : ttlMsForKind(kind);
  return new Date(now.getTime() + durationMs).toISOString();
}

export function isExpired(expireAt: string | undefined, now: Date): boolean {
  if (expireAt === undefined) {
    return false;
  }
  return Date.parse(expireAt) <= now.getTime();
}
