import { issueLocalAccessToken } from '@mnem-steward/auth';
import { describe, expect, it } from 'vitest';

import { createApp } from './create-app.js';
import { createGatewayDeps } from './create-deps.js';
import { parseEnv } from './env.js';

function testApp(extraEnv: Record<string, string | undefined> = {}) {
  const env = parseEnv({
    PUBLIC_BASE_URL: 'http://127.0.0.1:8080',
    AUTH_MODE: 'local',
    MEMORY_STORE: 'in-memory',
    LOCAL_JWT_SECRET: 'local-dev-secret-at-least-32-bytes!',
    ...extraEnv,
  });
  return createApp(createGatewayDeps(env));
}

async function bearerToken(app: ReturnType<typeof testApp>, sub = 'alice'): Promise<string> {
  const response = await app.request('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      sub,
      scope: 'memory.read memory.write memory.delete memory.profile.read memory.history.read',
    }),
  });
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

function mcpHeaders(token: string, protocolVersion = '2025-06-18'): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': protocolVersion,
  };
}

describe('gateway HTTP', () => {
  it('serves health and RFC 9728 metadata without a token', async () => {
    const app = testApp();
    const health = await app.request('/healthz');
    expect(health.status).toBe(200);
    const prm = await app.request('/.well-known/oauth-protected-resource');
    expect(prm.status).toBe(200);
    const document = (await prm.json()) as { resource: string };
    expect(document.resource).toBe('http://127.0.0.1:8080');
    const readerPrm = await app.request(
      '/.well-known/oauth-protected-resource/memory-reader/v1/mcp',
    );
    expect(((await readerPrm.json()) as { resource: string }).resource).toBe(
      'http://127.0.0.1:8080/memory-reader/v1/mcp',
    );
    const legacyMcpPrm = await app.request('/.well-known/oauth-protected-resource/mcp');
    expect(legacyMcpPrm.status).toBe(404);
  });

  it('rejects unauthenticated REST with WWW-Authenticate', async () => {
    const app = testApp();
    const response = await app.request('/v1/memories:search', { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain(
      'resource_metadata="http://127.0.0.1:8080/.well-known/oauth-protected-resource"',
    );
  });

  it('rejects unauthenticated MCP with profile-specific WWW-Authenticate', async () => {
    const app = testApp();
    const response = await app.request('/memory-reader/v1/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain(
      'resource_metadata="http://127.0.0.1:8080/.well-known/oauth-protected-resource/memory-reader/v1/mcp"',
    );
  });

  it('round-trips personal memory over REST', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const created = await app.request('/v1/memories', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        context: 'personal',
        kind: 'preference',
        classification: 'internal',
        fact: 'preferred_package_manager: pnpm',
      }),
    });
    expect(created.status).toBe(201);
    const record = (await created.json()) as { id: string };
    const search = await app.request('/v1/memories:search', {
      method: 'POST',
      headers,
      body: JSON.stringify({ context: 'personal', text: 'pnpm' }),
    });
    const found = (await search.json()) as {
      status: string;
      notice: string;
      memories: { id: string }[];
    };
    expect(found.status).toBe('ok');
    expect(found.notice).toContain('untrusted');
    expect(found.memories[0]?.id).toBe(record.id);
    const profile = await app.request('/v1/profiles/employee-agent', { headers });
    const profileBody = (await profile.json()) as { profile: { fields: Record<string, unknown> } };
    expect(profileBody.profile.fields['preferred_package_manager']).toBe('pnpm');
    const history = await app.request(`/v1/memories/${record.id}/history`, { headers });
    expect(history.status).toBe(200);
    const forgotten = await app.request(`/v1/memories/${record.id}`, { method: 'DELETE', headers });
    expect(forgotten.status).toBe(204);
    const unknownSchema = await app.request('/v1/profiles/nope', { headers });
    expect(unknownSchema.status).toBe(400);
  });

  it('denies current_project writes', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const response = await app.request('/v1/memories', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: 'current_project',
        kind: 'fact',
        classification: 'internal',
        fact: 'should not persist',
      }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('namespace_denied');
  });
});

describe('gateway MCP profiles', () => {
  it('lists only reader tools with annotations on memory-reader', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const headers = mcpHeaders(token);
    const listed = await app.request('/memory-reader/v1/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    const listBody = (await listed.json()) as {
      result: {
        tools: {
          name: string;
          annotations: { readOnlyHint?: boolean; openWorldHint?: boolean };
        }[];
      };
    };
    const names = listBody.result.tools.map((tool) => tool.name);
    expect(names).toEqual(['memory_search', 'memory_profile_get']);
    expect(listBody.result.tools[0]?.annotations.readOnlyHint).toBe(true);
    expect(listBody.result.tools[0]?.annotations.openWorldHint).toBe(false);
  });

  it('rejects memory_forget on reader even with a full-scope token', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const response = await app.request('/memory-reader/v1/mcp', {
      method: 'POST',
      headers: mcpHeaders(token),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'memory_forget', arguments: { id: 'mem_x' } },
      }),
    });
    const body = (await response.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain('memory_forget');
  });

  it('rejects off-profile resources with JSON-RPC -32602', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const response = await app.request('/memory-governance/v1/mcp', {
      method: 'POST',
      headers: mcpHeaders(token),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'resources/read',
        params: { uri: 'memory://profiles/employee-agent' },
      }),
    });
    const body = (await response.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32602);
  });

  it('returns -32601 for unknown methods', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const response = await app.request('/memory-reader/v1/mcp', {
      method: 'POST',
      headers: mcpHeaders(token),
      body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'nope' }),
    });
    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });

  it('publishes tool-derived scopes on profile PRM', async () => {
    const app = testApp();
    const response = await app.request(
      '/.well-known/oauth-protected-resource/memory-governance/v1/mcp',
    );
    const body = (await response.json()) as { scopes_supported: string[] };
    expect(body.scopes_supported).toEqual(['memory.delete', 'memory.history.read']);
  });

  it('accepts a JWT whose aud is the profile resource URL', async () => {
    const env = parseEnv({
      PUBLIC_BASE_URL: 'http://127.0.0.1:8080',
      AUTH_MODE: 'local',
      MEMORY_STORE: 'in-memory',
      LOCAL_JWT_SECRET: 'local-dev-secret-at-least-32-bytes!',
    });
    const app = createApp(createGatewayDeps(env));
    if (env.localJwtSecret === undefined) {
      throw new Error('expected local secret');
    }
    const token = await issueLocalAccessToken({
      secret: env.localJwtSecret,
      issuer: env.tokenIssuer,
      audience: 'http://127.0.0.1:8080/memory-reader/v1/mcp',
      subject: 'profile-aud',
      scopes: ['memory.read', 'memory.profile.read'],
    });
    const response = await app.request('/memory-reader/v1/mcp', {
      method: 'POST',
      headers: mcpHeaders(token),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(response.status).toBe(200);
  });

  it('remembers on steward and forgets on governance', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const headers = mcpHeaders(token);
    const initialized = await app.request('/memory-steward/v1/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      }),
    });
    expect(initialized.status).toBe(200);
    const initBody = (await initialized.json()) as {
      result: { serverInfo: { name: string } };
    };
    expect(initBody.result.serverInfo.name).toBe('mnem-steward');

    const called = await app.request('/memory-steward/v1/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'memory_remember',
          arguments: {
            context: 'personal',
            kind: 'fact',
            classification: 'internal',
            fact: 'This repository uses pnpm',
          },
        },
      }),
    });
    const callBody = (await called.json()) as {
      result: { isError: boolean; structuredContent: { fact: string; id: string } };
    };
    expect(callBody.result.isError).toBe(false);
    expect(callBody.result.structuredContent.fact).toContain('pnpm');

    const searchCall = await app.request('/memory-reader/v1/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/call',
        params: { name: 'memory_search', arguments: { context: 'personal', text: 'pnpm' } },
      }),
    });
    expect(searchCall.status).toBe(200);

    const profileCall = await app.request('/memory-reader/v1/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 32,
        method: 'tools/call',
        params: { name: 'memory_profile_get', arguments: { schema: 'employee-agent' } },
      }),
    });
    expect(profileCall.status).toBe(200);

    const historyCall = await app.request('/memory-governance/v1/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 40,
        method: 'tools/call',
        params: {
          name: 'memory_history',
          arguments: { id: callBody.result.structuredContent.id },
        },
      }),
    });
    expect(historyCall.status).toBe(200);

    const forgetCall = await app.request('/memory-governance/v1/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 41,
        method: 'tools/call',
        params: { name: 'memory_forget', arguments: { id: callBody.result.structuredContent.id } },
      }),
    });
    expect(forgetCall.status).toBe(200);

    const listedResources = await app.request('/memory-governance/v1/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 33, method: 'resources/list' }),
    });
    const resourcesBody = (await listedResources.json()) as {
      result: { resources: { uri: string }[] };
    };
    expect(resourcesBody.result.resources.map((resource) => resource.uri)).toEqual([
      'memory://policy',
      'memory://namespaces',
    ]);

    for (const uri of ['memory://policy', 'memory://namespaces']) {
      const read = await app.request('/memory-governance/v1/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: uri,
          method: 'resources/read',
          params: { uri },
        }),
      });
      expect(read.status).toBe(200);
    }
  });

  it('rejects 2026-07-28 tools/call without Mcp-Method', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const response = await app.request('/memory-reader/v1/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'memory_search', arguments: { context: 'personal' } },
      }),
    });
    expect(response.status).toBe(400);
  });

  it('accepts 2026-07-28 ping when headers match', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const response = await app.request('/memory-reader/v1/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'ping',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'ping' }),
    });
    expect(response.status).toBe(200);
    const get = await app.request('/memory-reader/v1/mcp', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(get.status).toBe(405);
  });

  it('does not mount profiles excluded by MNEM_STEWARD_MCP_PROFILES', async () => {
    const app = testApp({ MNEM_STEWARD_MCP_PROFILES: 'memory-reader' });
    const token = await bearerToken(app);
    const reader = await app.request('/memory-reader/v1/mcp', {
      method: 'POST',
      headers: mcpHeaders(token),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(reader.status).toBe(200);
    const steward = await app.request('/memory-steward/v1/mcp', {
      method: 'POST',
      headers: mcpHeaders(token),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(steward.status).toBe(404);
    const stewardPrm = await app.request(
      '/.well-known/oauth-protected-resource/memory-steward/v1/mcp',
    );
    expect(stewardPrm.status).toBe(404);
  });

  it('rejects secret writes over REST', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const response = await app.request('/v1/memories', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: 'personal',
        kind: 'fact',
        classification: 'internal',
        fact: '-----BEGIN PRIVATE KEY-----',
      }),
    });
    expect(response.status).toBe(403);
  });

  it('rejects invalid JSON bodies', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const response = await app.request('/v1/memories:search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(response.status).toBe(400);
  });
});
