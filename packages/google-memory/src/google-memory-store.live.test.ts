import { createFixedClock, createMemoryService, principalIdFromOidc } from '@mnem-steward/core';
import { describe, expect, it } from 'vitest';

import { createAccessTokenProvider } from './access-token.js';
import { googleMemoryConfigFromEnv, isGoogleMemoryConfigured } from './config.js';
import { createGoogleMemoryStore } from './google-memory-store.js';

import type { Principal } from '@mnem-steward/core';

const live = isGoogleMemoryConfigured(process.env);

describe('live Google Memory Bank', () => {
  it.skipIf(!live)('requires project, location, and reasoning engine env', () => {
    expect(isGoogleMemoryConfigured(process.env)).toBe(true);
  });

  it.skipIf(!live)(
    'remembers a preference via DirectMemory generate and applies expireTime when PATCH works',
    async () => {
      const config = googleMemoryConfigFromEnv(process.env);
      const store = createGoogleMemoryStore({
        config,
        http: { fetch },
        tokens: createAccessTokenProvider({
          envToken: process.env['GOOGLE_ACCESS_TOKEN'],
        }),
      });
      const principal: Principal = {
        id: principalIdFromOidc('https://issuer.example', 'live-harden'),
        issuer: 'https://issuer.example',
        subject: 'live-harden',
        scopes: [
          'memory.read',
          'memory.write',
          'memory.delete',
          'memory.profile.read',
          'memory.history.read',
        ],
      };
      const clock = createFixedClock('2026-08-26T00:00:00.000Z');
      const memory = createMemoryService({
        store,
        audit: { record: () => Promise.resolve() },
        clock,
      });
      const expireAt = '2026-09-26T00:00:00.000Z';
      const remembered = await memory.remember(
        {
          principal,
          context: 'personal',
          kind: 'preference',
          classification: 'internal',
          fact: `preferred_test_run: harden-${String(Date.now())}`,
          ttl: { expireAt },
        },
        { protocol: 'mcp' },
      );
      expect(remembered.id.length).toBeGreaterThan(0);
      expect(remembered.kind).toBe('preference');
      // Control-plane expireAt is always returned; Memory Bank PATCH may or may not stick.
      expect(remembered.expireAt).toBe(expireAt);

      const found = await memory.search(
        {
          principal,
          context: 'personal',
          text: 'preferred_test_run',
        },
        { protocol: 'mcp' },
      );
      expect(found.status).toBe('ok');
      if (found.status === 'ok') {
        expect(found.memories.some((item) => item.id === remembered.id)).toBe(true);
      }
    },
    120_000,
  );
});
