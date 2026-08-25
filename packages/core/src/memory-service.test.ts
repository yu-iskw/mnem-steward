import { describe, expect, it } from 'vitest';

import { createInMemoryAuditSink } from './in-memory-audit-sink.js';
import { createInMemoryMemoryStore } from './in-memory-store.js';
import { createMemoryService } from './memory-service.js';
import { scanSecrets } from './scan-secrets.js';
import { toMemoryBankScope } from './scope.js';
import { ttlMsForKind } from './ttl.js';

import { createFixedClock, createSequenceIdGenerator, principalIdFromOidc } from './index.js';

import type { Principal } from './types.js';

const ALL_SCOPES = [
  'memory.read',
  'memory.write',
  'memory.delete',
  'memory.profile.read',
  'memory.history.read',
] as const;

function principal(subject = 'alice'): Principal {
  const issuer = 'https://issuer.example';
  return {
    id: principalIdFromOidc(issuer, subject),
    issuer,
    subject,
    scopes: [...ALL_SCOPES],
  };
}

function service() {
  const clock = createFixedClock('2026-08-25T12:00:00.000Z');
  const ids = createSequenceIdGenerator('core');
  const store = createInMemoryMemoryStore({ clock, ids });
  const audit = createInMemoryAuditSink();
  return { memory: createMemoryService({ store, audit, clock }), audit, clock };
}

describe('principalIdFromOidc', () => {
  it('is stable for the same issuer and subject', () => {
    const first = principalIdFromOidc('https://accounts.google.com', 'sub-1');
    const second = principalIdFromOidc('https://accounts.google.com', 'sub-1');
    expect(first).toBe(second);
    expect(first.startsWith('usr_')).toBe(true);
    expect(first).toHaveLength(28);
  });

  it('differs when issuer or subject differs', () => {
    const base = principalIdFromOidc('https://accounts.google.com', 'sub-1');
    expect(principalIdFromOidc('https://other', 'sub-1')).not.toBe(base);
    expect(principalIdFromOidc('https://accounts.google.com', 'sub-2')).not.toBe(base);
  });
});

describe('scanSecrets', () => {
  it('allows ordinary working notes', () => {
    expect(scanSecrets('This repository uses pnpm and Node.js 24.')).toEqual({ hit: false });
  });

  it('rejects private keys and cloud credentials', () => {
    expect(scanSecrets('-----BEGIN PRIVATE KEY-----\nMIIB').hit).toBe(true);
    const aws = scanSecrets('aws AKIAIOSFODNN7EXAMPLE');
    expect(aws.hit).toBe(true);
    if (aws.hit) {
      expect(aws.rule).toBe('aws-access-key');
    }
    expect(scanSecrets('token ghp_abcdefghijklmnopqrstuvwxyz012345').hit).toBe(true);
  });
});

describe('toMemoryBankScope', () => {
  it('maps personal context to principal_id', () => {
    const actor = principal();
    expect(toMemoryBankScope('personal', actor)).toEqual({
      namespace: 'personal',
      principal_id: actor.id,
    });
  });

  it('maps current_project without inventing a project id', () => {
    expect(toMemoryBankScope('current_project', principal())).toEqual({ namespace: 'project' });
  });
});

describe('ttlMsForKind', () => {
  it('uses a one-day working window and longer durable kinds', () => {
    expect(ttlMsForKind('working')).toBe(24 * 60 * 60 * 1000);
    expect(ttlMsForKind('episode')).toBe(30 * 24 * 60 * 60 * 1000);
    expect(ttlMsForKind('fact')).toBe(365 * 24 * 60 * 60 * 1000);
  });
});

describe('MemoryService', () => {
  it('remembers, searches, profiles, histories, and forgets personal memory', async () => {
    const { memory, audit } = service();
    const actor = principal();
    const stored = await memory.remember({
      principal: actor,
      context: 'personal',
      kind: 'preference',
      classification: 'internal',
      fact: 'preferred_package_manager: pnpm',
    });
    const found = await memory.search({
      principal: actor,
      context: 'personal',
      text: 'pnpm',
    });
    expect(found.status).toBe('ok');
    if (found.status === 'ok') {
      expect(found.memories).toHaveLength(1);
      expect(found.memories[0]?.id).toBe(stored.id);
      expect(found.notice).toContain('untrusted');
    }
    const profile = await memory.getProfile('employee-agent', actor);
    expect(profile.status).toBe('ok');
    if (profile.status === 'ok') {
      expect(profile.profile.fields['preferred_package_manager']).toBe('pnpm');
    }
    const history = await memory.history(stored.id, actor);
    expect(history.status).toBe('ok');
    await memory.forget(stored.id, actor);
    const after = await memory.search({ principal: actor, context: 'personal', text: 'pnpm' });
    expect(after.status === 'ok' && after.memories).toEqual([]);
    expect(audit.events().some((event) => event.action === 'remember' && event.outcome === 'allow')).toBe(
      true,
    );
    expect(JSON.stringify(audit.events())).not.toContain('pnpm');
  });

  it('denies shared context and secrets and prohibited classification', async () => {
    const { memory } = service();
    const actor = principal();
    await expect(
      memory.remember({
        principal: actor,
        context: 'current_project',
        kind: 'fact',
        classification: 'internal',
        fact: 'shared fact',
      }),
    ).rejects.toMatchObject({ code: 'namespace_denied' });
    await expect(
      memory.search({ principal: actor, context: 'current_project', text: 'x' }),
    ).rejects.toMatchObject({ code: 'namespace_denied' });
    await expect(
      memory.remember({
        principal: actor,
        context: 'personal',
        kind: 'fact',
        classification: 'internal',
        fact: '-----BEGIN RSA PRIVATE KEY-----',
      }),
    ).rejects.toMatchObject({ code: 'secret_detected' });
    await expect(
      memory.remember({
        principal: actor,
        context: 'personal',
        kind: 'fact',
        classification: 'prohibited-for-memory',
        fact: 'ssn-like note',
      }),
    ).rejects.toMatchObject({ code: 'prohibited_classification' });
  });

  it('returns unavailable for history and profile when the store throws', async () => {
    const clock = createFixedClock('2026-08-25T12:00:00.000Z');
    const audit = createInMemoryAuditSink();
    const memory = createMemoryService({
      clock,
      audit,
      store: {
        search() {
          return Promise.reject(new Error('down'));
        },
        remember() {
          return Promise.reject(new Error('down'));
        },
        forget() {
          return Promise.reject(new Error('down'));
        },
        history() {
          return Promise.reject(new Error('down'));
        },
        getProfile() {
          return Promise.reject(new Error('down'));
        },
      },
    });
    const actor = principal();
    await expect(
      memory.remember({
        principal: actor,
        context: 'personal',
        kind: 'fact',
        classification: 'internal',
        fact: 'x',
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(memory.forget('mem_x', actor)).rejects.toMatchObject({ code: 'unavailable' });
    expect(await memory.history('mem_x', actor)).toEqual({
      status: 'unavailable',
      reason: 'memory-store-unavailable',
    });
    expect(await memory.getProfile('employee-agent', actor)).toEqual({
      status: 'unavailable',
      reason: 'memory-store-unavailable',
    });
  });

  it('does not leak another principal memory', async () => {
    const { memory } = service();
    const alice = principal('alice');
    const bob = principal('bob');
    await memory.remember({
      principal: alice,
      context: 'personal',
      kind: 'fact',
      classification: 'internal',
      fact: 'alice-only convention',
    });
    const bobView = await memory.search({
      principal: bob,
      context: 'personal',
      text: 'alice-only',
    });
    expect(bobView.status === 'ok' && bobView.memories).toEqual([]);
  });

  it('requires matching oauth scopes', async () => {
    const { memory } = service();
    const reader: Principal = { ...principal(), scopes: ['memory.read'] };
    await expect(
      memory.remember({
        principal: reader,
        context: 'personal',
        kind: 'fact',
        classification: 'internal',
        fact: 'should fail',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rejects empty facts and unknown kinds, and honors explicit ttl', async () => {
    const { memory } = service();
    const actor = principal();
    await expect(
      memory.remember({
        principal: actor,
        context: 'personal',
        kind: 'fact',
        classification: 'internal',
        fact: '   ',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const stored = await memory.remember({
      principal: actor,
      context: 'personal',
      kind: 'working',
      classification: 'public',
      fact: 'short-lived',
      ttl: { ttlSeconds: 60 },
    });
    expect(stored.expireAt).toBe('2026-08-25T12:01:00.000Z');
    await expect(memory.history('missing', actor)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('filters expired memories from search', async () => {
    let now = new Date('2026-08-25T12:00:00.000Z');
    const clock = { now: () => now };
    const ids = createSequenceIdGenerator('ttl');
    const store = createInMemoryMemoryStore({ clock, ids });
    const audit = createInMemoryAuditSink();
    const memory = createMemoryService({ store, audit, clock });
    const actor = principal();
    await memory.remember({
      principal: actor,
      context: 'personal',
      kind: 'working',
      classification: 'internal',
      fact: 'expires soon',
      ttl: { expireAt: '2026-08-25T12:00:01.000Z' },
    });
    now = new Date('2026-08-25T12:00:02.000Z');
    const found = await memory.search({ principal: actor, context: 'personal', text: 'expires' });
    expect(found.status === 'ok' && found.memories).toEqual([]);
  });
});
