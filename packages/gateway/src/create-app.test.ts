import { describe, expect, it } from 'vitest';

import { createApp } from './create-app.js';
import { createGatewayDeps } from './create-deps.js';
import { parseEnv } from './env.js';

function testApp() {
  const env = parseEnv({
    PUBLIC_BASE_URL: 'http://127.0.0.1:8080',
    AUTH_MODE: 'local',
    MEMORY_STORE: 'in-memory',
    LOCAL_JWT_SECRET: 'local-dev-secret-at-least-32-bytes!',
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

describe('gateway HTTP', () => {
  it('serves health and RFC 9728 metadata without a token', async () => {
    const app = testApp();
    const health = await app.request('/healthz');
    expect(health.status).toBe(200);
    const prm = await app.request('/.well-known/oauth-protected-resource');
    expect(prm.status).toBe(200);
    const document = (await prm.json()) as { resource: string };
    expect(document.resource).toBe('http://127.0.0.1:8080');
    const mcpPrm = await app.request('/.well-known/oauth-protected-resource/mcp');
    expect(((await mcpPrm.json()) as { resource: string }).resource).toBe('http://127.0.0.1:8080/mcp');
  });

  it('rejects unauthenticated REST with WWW-Authenticate', async () => {
    const app = testApp();
    const response = await app.request('/v1/memories:search', { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
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
    const found = (await search.json()) as { status: string; notice: string; memories: { id: string }[] };
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

describe('gateway MCP', () => {
  it('lists tools after initialize and remembers through tools/call', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
    };
    const initialized = await app.request('/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
      }),
    });
    expect(initialized.status).toBe(200);
    const listed = await app.request('/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    const listBody = (await listed.json()) as { result: { tools: { name: string }[] } };
    expect(listBody.result.tools.map((tool) => tool.name)).toContain('memory_search');
    const called = await app.request('/mcp', {
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
    const searchCall = await app.request('/mcp', {
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
    const profileCall = await app.request('/mcp', {
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
    const listedResources = await app.request('/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 33, method: 'resources/list' }),
    });
    expect(listedResources.status).toBe(200);
    const initializedNote = await app.request('/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(initializedNote.status).toBe(202);
    const unknown = await app.request('/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 34, method: 'nope' }),
    });
    expect(unknown.status).toBe(200);
    for (const uri of ['memory://policy', 'memory://namespaces', 'memory://profiles/employee-agent']) {
      const read = await app.request('/mcp', {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: uri, method: 'resources/read', params: { uri } }),
      });
      expect(read.status).toBe(200);
    }
    const historyCall = await app.request('/mcp', {
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
    const forgetCall = await app.request('/mcp', {
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
    const resource = await app.request('/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/read',
        params: { uri: 'memory://policy' },
      }),
    });
    expect(resource.status).toBe(200);
  });

  it('rejects 2026-07-28 tools/call without Mcp-Method', async () => {
    const app = testApp();
    const token = await bearerToken(app);
    const response = await app.request('/mcp', {
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
    const response = await app.request('/mcp', {
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
    const get = await app.request('/mcp', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    expect(get.status).toBe(405);
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
});
