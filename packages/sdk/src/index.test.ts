import { describe, expect, it } from 'vitest';

import { createMemoryClient, MemoryClientError } from './index.js';

import type { MemoryRecord } from '@enterprise-memory/core';

const stored: MemoryRecord = {
  id: 'mem_1',
  kind: 'fact',
  namespace: 'personal',
  principalId: 'usr_abc',
  classification: 'internal',
  fact: 'SDK round-trip works',
  createdAt: '2026-08-25T12:00:00.000Z',
  updatedAt: '2026-08-25T12:00:00.000Z',
};

describe('MemoryClient', () => {
  it('uses injected fetch and maps REST payloads', async () => {
    const client = createMemoryClient({
      baseUrl: 'http://memory.test',
      accessToken: 'token',
      fetch: (input, init) => {
        const url = typeof input === 'string' ? input : 'http://memory.test';
        const method = init?.method ?? 'GET';
        if (url.endsWith('/v1/memories') && method === 'POST') {
          return Promise.resolve(json(stored, 201));
        }
        if (url.endsWith('/v1/memories:search') && method === 'POST') {
          return Promise.resolve(json({ status: 'ok', memories: [stored], notice: 'untrusted' }));
        }
        return Promise.resolve(json({ error: 'not_found', message: 'missing' }, 404));
      },
    });
    const created = await client.remember({
      kind: 'fact',
      classification: 'internal',
      fact: 'SDK round-trip works',
    });
    expect(created.id).toBe('mem_1');
    const found = await client.search({ text: 'round-trip' });
    expect(found.status).toBe('ok');
  });

  it('supports forget, history, and profile helpers', async () => {
    const client = createMemoryClient({
      baseUrl: 'http://memory.test',
      accessToken: 'token',
      fetch: (input, init) => {
        const url = typeof input === 'string' ? input : 'http://memory.test';
        const method = init?.method ?? 'GET';
        if (method === 'DELETE') {
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        if (url.includes('/history')) {
          return Promise.resolve(json({ status: 'ok', revisions: [] }));
        }
        if (url.includes('/profiles/')) {
          return Promise.resolve(
            json({
              status: 'ok',
              profile: { schema: 'employee-agent', principalId: 'usr_abc', fields: {} },
              notice: 'untrusted',
            }),
          );
        }
        return Promise.resolve(json({ error: 'not_found' }, 404));
      },
    });
    await client.forget('mem_1');
    const history = await client.history('mem_1');
    expect(history.status).toBe('ok');
    const profile = await client.getProfile();
    expect(profile.status).toBe('ok');
  });

  it('throws MemoryClientError on HTTP failures', async () => {
    const client = createMemoryClient({
      baseUrl: 'http://memory.test',
      accessToken: 'token',
      fetch: () => Promise.resolve(json({ error: 'unauthenticated', message: 'nope' }, 401)),
    });
    await expect(client.search({ text: 'x' })).rejects.toBeInstanceOf(MemoryClientError);
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
