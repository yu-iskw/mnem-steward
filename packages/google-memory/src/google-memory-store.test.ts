import { principalIdFromOidc, UNTRUSTED_MEMORY_NOTICE } from '@enterprise-memory/core';
import { describe, expect, it } from 'vitest';

import { isGoogleMemoryConfigured, memoryBankBaseUrl, memoryBankParent } from './config.js';
import { createGoogleMemoryStore } from './google-memory-store.js';
import { generateMemoriesBody, parseProfile, parseRetrievedMemories, parseRevisions } from './map-record.js';

import type { Principal } from '@enterprise-memory/core';

const actor: Principal = {
  id: principalIdFromOidc('https://issuer.example', 'alice'),
  issuer: 'https://issuer.example',
  subject: 'alice',
  scopes: ['memory.read', 'memory.write', 'memory.delete', 'memory.profile.read', 'memory.history.read'],
};

describe('google memory mapping', () => {
  it('builds generate and retrieve bodies from enterprise scope', () => {
    const body = generateMemoriesBody({
      principal: actor,
      context: 'personal',
      kind: 'preference',
      classification: 'internal',
      fact: 'preferred_package_manager: pnpm',
    });
    expect(body['scope']).toEqual({ namespace: 'personal', principal_id: actor.id });
    expect(memoryBankParent({ project: 'p', location: 'eu', reasoningEngineId: 'eng' })).toContain(
      'reasoningEngines/eng',
    );
  });

  it('maps global and regional endpoints and env config', () => {
    expect(memoryBankBaseUrl('global')).toBe('https://aiplatform.googleapis.com');
    expect(memoryBankBaseUrl('us-central1')).toBe('https://us-central1-aiplatform.googleapis.com');
  });

  it('returns unavailable when the injected HTTP client fails', async () => {
    const store = createGoogleMemoryStore({
      config: { project: 'p', location: 'eu', reasoningEngineId: 'eng' },
      http: {
        fetch() {
          return Promise.resolve(new Response('nope', { status: 500 }));
        },
      },
      tokens: {
        getAccessToken() {
          return Promise.resolve('token');
        },
      },
    });
    const outcome = await store.search({ principal: actor, context: 'personal', text: 'x' });
    expect(outcome.status).toBe('unavailable');
  });

  it('parses retrieve payloads into domain records', () => {
    const records = parseRetrievedMemories(
      {
        retrievedMemories: [
          {
            memory: {
              name: 'projects/p/locations/eu/reasoningEngines/eng/memories/abc',
              fact: 'preference: preferred_package_manager: pnpm',
              createTime: '2026-08-25T12:00:00Z',
            },
          },
        ],
      },
      actor,
    );
    expect(records[0]?.id).toBe('abc');
    expect(records[0]?.kind).toBe('preference');
    expect(records[0]?.fact).toBe('preferred_package_manager: pnpm');
  });

  it('parses revisions and profiles', () => {
    const revisions = parseRevisions(
      {
        memoryRevisions: [
          { name: 'projects/p/locations/eu/reasoningEngines/eng/memories/abc/revisions/r1', createTime: '2026-08-25T12:00:00Z' },
        ],
      },
      'abc',
    );
    expect(revisions[0]?.revisionId).toBe('r1');
    const profile = parseProfile(
      { profiles: { 'employee-agent': { schemaId: 'employee-agent', profile: { lang: 'ts' } } } },
      actor,
    );
    expect(profile.status).toBe('ok');
    if (profile.status === 'ok') {
      expect(profile.profile.fields['lang']).toBe('ts');
    }
  });
});

describe('google memory store with injected HTTP', () => {
  it('searches and remembers through the REST adapter', async () => {
    const http = createFakeMemoryBank();
    const store = createGoogleMemoryStore({
      config: { project: 'p', location: 'eu', reasoningEngineId: 'eng' },
      http,
      tokens: { getAccessToken() { return Promise.resolve('ya29.token'); } },
    });
    const remembered = await store.remember({
      principal: actor,
      context: 'personal',
      kind: 'fact',
      classification: 'internal',
      fact: 'Uses Cloud Run',
    });
    expect(remembered.fact).toBe('Uses Cloud Run');
    const found = await store.search({ principal: actor, context: 'personal', text: 'Cloud Run' });
    expect(found.status).toBe('ok');
    if (found.status === 'ok') {
      expect(found.notice).toBe(UNTRUSTED_MEMORY_NOTICE);
      expect(found.memories.some((item) => item.fact.includes('Cloud Run'))).toBe(true);
    }
  });

  it('skips live configuration unless env is present', () => {
    expect(isGoogleMemoryConfigured({})).toBe(false);
    expect(
      isGoogleMemoryConfigured({
        GOOGLE_CLOUD_PROJECT: 'p',
        GOOGLE_CLOUD_LOCATION: 'eu',
        GOOGLE_REASONING_ENGINE_ID: 'eng',
      }),
    ).toBe(true);
  });
});

function createFakeMemoryBank(): { fetch: (url: string, init?: RequestInit) => Promise<Response> } {
  const memories = new Map<string, { name: string; fact: string }>();
  return {
    fetch(url: string, init?: RequestInit): Promise<Response> {
      const method = init?.method ?? 'GET';
      if (url.endsWith(':generate') && method === 'POST') {
        const name = 'projects/p/locations/eu/reasoningEngines/eng/memories/mem1';
        const rawBody = init?.body;
        const text = typeof rawBody === 'string' ? rawBody : '{}';
        const parsed = JSON.parse(text) as {
          directMemoriesSource?: { directMemories?: { fact: string }[] };
        };
        const fact = parsed.directMemoriesSource?.directMemories?.[0]?.fact ?? 'fact: unknown';
        memories.set(name, { name, fact });
        return Promise.resolve(
          json({
            done: true,
            generatedMemories: [{ memory: { name }, action: 'CREATED' }],
          }),
        );
      }
      if (url.endsWith(':retrieve') && method === 'POST') {
        return Promise.resolve(
          json({
            retrievedMemories: [...memories.values()].map((memory) => ({ memory })),
          }),
        );
      }
      const existing = [...memories.values()].find((item) => url.endsWith(item.name) || url.includes(item.name));
      if (method === 'GET' && existing !== undefined && !url.endsWith('/revisions')) {
        return Promise.resolve(json(existing));
      }
      return Promise.resolve(json({}, 404));
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
