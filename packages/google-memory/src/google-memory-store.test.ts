import { principalIdFromOidc, UNTRUSTED_MEMORY_NOTICE } from '@mnem-steward/core';
import { describe, expect, it } from 'vitest';

import { isGoogleMemoryConfigured, memoryBankBaseUrl, memoryBankParent } from './config.js';
import { createGoogleMemoryStore } from './google-memory-store.js';
import {
  generateMemoriesBody,
  parseProfile,
  parseRetrievedMemories,
  parseRevisions,
} from './map-record.js';

import type { Principal } from '@mnem-steward/core';

const actor: Principal = {
  id: principalIdFromOidc('https://issuer.example', 'alice'),
  issuer: 'https://issuer.example',
  subject: 'alice',
  scopes: [
    'memory.read',
    'memory.write',
    'memory.delete',
    'memory.profile.read',
    'memory.history.read',
  ],
};

const bob: Principal = {
  id: principalIdFromOidc('https://issuer.example', 'bob'),
  issuer: 'https://issuer.example',
  subject: 'bob',
  scopes: actor.scopes,
};

describe('google memory mapping', () => {
  it('builds generate and retrieve bodies from enterprise scope', () => {
    const body = generateMemoriesBody({
      principal: actor,
      context: 'personal',
      kind: 'preference',
      classification: 'internal',
      fact: 'preferred_package_manager: pnpm',
      ttl: { expireAt: '2026-08-26T12:00:00.000Z' },
    });
    expect(body['scope']).toEqual({ namespace: 'personal', principal_id: actor.id });
    const source = body['directMemoriesSource'] as {
      directMemories: { expireTime: string; fact: string }[];
    };
    expect(source.directMemories[0]?.expireTime).toBe('2026-08-26T12:00:00.000Z');
    expect(source.directMemories[0]?.fact).toBe(
      'preference|internal: preferred_package_manager: pnpm',
    );
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

  it('treats a retrieve payload without retrievedMemories as unavailable', async () => {
    const store = createGoogleMemoryStore({
      config: { project: 'p', location: 'eu', reasoningEngineId: 'eng' },
      http: {
        fetch() {
          return Promise.resolve(json({ unexpected: true }));
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
    expect(parseRetrievedMemories({ unexpected: true }, actor)).toBeUndefined();
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
              scope: { namespace: 'personal', principal_id: actor.id },
            },
          },
        ],
      },
      actor,
    );
    expect(records?.[0]?.id).toBe('abc');
    expect(records?.[0]?.kind).toBe('preference');
    expect(records?.[0]?.classification).toBe('internal');
    expect(records?.[0]?.fact).toBe('preferred_package_manager: pnpm');
  });

  it('preserves persistable classifications encoded in the stored fact', () => {
    const records = parseRetrievedMemories(
      {
        retrievedMemories: [
          {
            memory: {
              name: 'projects/p/locations/eu/reasoningEngines/eng/memories/abc',
              fact: 'fact|confidential: restricted note',
              scope: { namespace: 'personal', principal_id: actor.id },
            },
          },
        ],
      },
      actor,
    );
    expect(records?.[0]?.classification).toBe('confidential');
    expect(records?.[0]?.kind).toBe('fact');
    expect(records?.[0]?.fact).toBe('restricted note');
  });

  it('drops memories owned by another principal', () => {
    const records = parseRetrievedMemories(
      {
        retrievedMemories: [
          {
            memory: {
              name: 'projects/p/locations/eu/reasoningEngines/eng/memories/abc',
              fact: 'fact: alice-only',
              scope: { namespace: 'personal', principal_id: actor.id },
            },
          },
        ],
      },
      bob,
    );
    expect(records).toEqual([]);
  });

  it('parses revisions and profiles', () => {
    const revisions = parseRevisions(
      {
        memoryRevisions: [
          {
            name: 'projects/p/locations/eu/reasoningEngines/eng/memories/abc/revisions/r1',
            createTime: '2026-08-25T12:00:00Z',
          },
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
      tokens: {
        getAccessToken() {
          return Promise.resolve('ya29.token');
        },
      },
    });
    const remembered = await store.remember({
      principal: actor,
      context: 'personal',
      kind: 'fact',
      classification: 'internal',
      fact: 'Uses Cloud Run',
      ttl: { expireAt: '2026-08-26T12:00:00.000Z' },
    });
    expect(remembered.fact).toBe('Uses Cloud Run');
    expect(remembered.classification).toBe('internal');
    const found = await store.search({ principal: actor, context: 'personal', text: 'Cloud Run' });
    expect(found.status).toBe('ok');
    if (found.status === 'ok') {
      expect(found.notice).toBe(UNTRUSTED_MEMORY_NOTICE);
      expect(found.memories.some((item) => item.fact.includes('Cloud Run'))).toBe(true);
    }
  });

  it('refuses forget and history for another principal or unsafe ids', async () => {
    const http = createFakeMemoryBank();
    const store = createGoogleMemoryStore({
      config: { project: 'p', location: 'eu', reasoningEngineId: 'eng' },
      http,
      tokens: {
        getAccessToken() {
          return Promise.resolve('ya29.token');
        },
      },
    });
    const remembered = await store.remember({
      principal: actor,
      context: 'personal',
      kind: 'fact',
      classification: 'internal',
      fact: 'alice-only convention',
    });
    await expect(store.forget(remembered.id, bob)).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.history(remembered.id, bob)).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.forget('..', actor)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(store.history('missing', actor)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('filters Google search results by requested kind', async () => {
    const store = createGoogleMemoryStore({
      config: { project: 'p', location: 'eu', reasoningEngineId: 'eng' },
      http: {
        fetch() {
          return Promise.resolve(
            json({
              retrievedMemories: [
                {
                  memory: {
                    name: 'projects/p/locations/eu/reasoningEngines/eng/memories/mem1',
                    fact: 'fact|internal: a fact',
                    scope: { namespace: 'personal', principal_id: actor.id },
                  },
                },
                {
                  memory: {
                    name: 'projects/p/locations/eu/reasoningEngines/eng/memories/mem2',
                    fact: 'preference|internal: a preference',
                    scope: { namespace: 'personal', principal_id: actor.id },
                  },
                },
              ],
            }),
          );
        },
      },
      tokens: {
        getAccessToken() {
          return Promise.resolve('token');
        },
      },
    });
    const found = await store.search({
      principal: actor,
      context: 'personal',
      kind: 'preference',
    });
    expect(found.status).toBe('ok');
    if (found.status === 'ok') {
      expect(found.memories).toHaveLength(1);
      expect(found.memories[0]?.kind).toBe('preference');
    }
  });

  it('polls pending generate operations until they complete', async () => {
    let operationGets = 0;
    const store = createGoogleMemoryStore({
      config: { project: 'p', location: 'eu', reasoningEngineId: 'eng' },
      sleep: () => Promise.resolve(),
      http: {
        fetch(url: string, init?: RequestInit) {
          const method = init?.method ?? 'GET';
          if (url.endsWith(':generate') && method === 'POST') {
            return Promise.resolve(
              json({ name: 'projects/p/locations/eu/operations/op1', done: false }),
            );
          }
          if (url.includes('/operations/op1') && method === 'GET') {
            operationGets += 1;
            if (operationGets < 2) {
              return Promise.resolve(
                json({ name: 'projects/p/locations/eu/operations/op1', done: false }),
              );
            }
            return Promise.resolve(
              json({
                done: true,
                generatedMemories: [
                  {
                    memory: {
                      name: 'projects/p/locations/eu/reasoningEngines/eng/memories/mem1',
                    },
                  },
                ],
              }),
            );
          }
          if (url.endsWith('/memories/mem1') && method === 'GET') {
            return Promise.resolve(
              json({
                name: 'projects/p/locations/eu/reasoningEngines/eng/memories/mem1',
                fact: 'fact|public: polled',
                scope: { namespace: 'personal', principal_id: actor.id },
              }),
            );
          }
          return Promise.resolve(json({}, 404));
        },
      },
      tokens: {
        getAccessToken() {
          return Promise.resolve('token');
        },
      },
    });
    const remembered = await store.remember({
      principal: actor,
      context: 'personal',
      kind: 'fact',
      classification: 'public',
      fact: 'polled',
    });
    expect(operationGets).toBe(2);
    expect(remembered.classification).toBe('public');
    expect(remembered.fact).toBe('polled');
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
  const memories = new Map<
    string,
    {
      name: string;
      fact: string;
      scope?: { namespace: string; principal_id?: string };
      expireTime?: string;
    }
  >();
  return {
    fetch(url: string, init?: RequestInit): Promise<Response> {
      const method = init?.method ?? 'GET';
      if (url.endsWith(':generate') && method === 'POST') {
        const name = 'projects/p/locations/eu/reasoningEngines/eng/memories/mem1';
        const rawBody = init?.body;
        const text = typeof rawBody === 'string' ? rawBody : '{}';
        const parsed = JSON.parse(text) as {
          scope?: { namespace: string; principal_id?: string };
          directMemoriesSource?: { directMemories?: { fact: string; expireTime?: string }[] };
        };
        const fact = parsed.directMemoriesSource?.directMemories?.[0]?.fact ?? 'fact: unknown';
        memories.set(name, {
          name,
          fact,
          scope: parsed.scope,
          expireTime: parsed.directMemoriesSource?.directMemories?.[0]?.expireTime,
        });
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
      if (method === 'DELETE') {
        const existing = [...memories.keys()].find((name) =>
          url.includes(`/${name.split('/').at(-1) ?? name}`),
        );
        if (existing !== undefined) {
          memories.delete(existing);
          return Promise.resolve(json({}, 204));
        }
        return Promise.resolve(json({}, 404));
      }
      const existing = [...memories.values()].find(
        (item) => url.includes(item.name) || url.endsWith(item.name),
      );
      if (method === 'GET' && existing !== undefined && url.endsWith('/revisions')) {
        return Promise.resolve(
          json({
            memoryRevisions: [
              { name: `${existing.name}/revisions/r1`, createTime: '2026-08-25T12:00:00Z' },
            ],
          }),
        );
      }
      if (method === 'GET' && existing !== undefined) {
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
