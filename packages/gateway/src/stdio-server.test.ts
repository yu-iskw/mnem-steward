import { PassThrough } from 'node:stream';

import { issueLocalAccessToken } from '@mnem-steward/auth';
import {
  createInMemoryAuditSink,
  createStdoutAuditSink,
  OAUTH_SCOPES,
} from '@mnem-steward/core';
import { describe, expect, it } from 'vitest';

import { createGatewayDeps } from './create-deps.js';
import { parseEnv } from './env.js';
import { handleMcpRequest, PROTOCOL_2025, PROTOCOL_2026 } from './mcp/handle-request.js';
import { readAccessToken, runStdioServer } from './stdio-server.js';

import type { Principal } from '@mnem-steward/core';

const SECRET = 'local-dev-secret-at-least-32-bytes!';

function testEnv() {
  return parseEnv({
    PUBLIC_BASE_URL: 'http://127.0.0.1:8080',
    AUTH_MODE: 'local',
    MEMORY_STORE: 'in-memory',
    LOCAL_JWT_SECRET: SECRET,
  });
}

async function testPrincipal(subject = 'alice'): Promise<{
  deps: ReturnType<typeof createGatewayDeps>;
  principal: Principal;
  token: string;
}> {
  const env = testEnv();
  const deps = createGatewayDeps(env);
  const secret = env.localJwtSecret;
  if (secret === undefined) {
    throw new Error('expected local JWT secret');
  }
  const token = await issueLocalAccessToken({
    secret,
    issuer: env.tokenIssuer,
    audience: env.tokenAudience,
    subject,
    scopes: [...OAUTH_SCOPES],
  });
  const principal = await deps.verifier.verify(`Bearer ${token}`);
  return { deps, principal, token };
}

describe('handleMcpRequest', () => {
  it('initializes and lists tools', async () => {
    const { deps, principal } = await testPrincipal();
    const initialized = await handleMcpRequest({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: PROTOCOL_2025, capabilities: {}, clientInfo: { name: 't' } },
      },
      memory: deps.memory,
      principal,
      protocolVersion: PROTOCOL_2025,
    });
    expect(initialized.type).toBe('json');
    if (initialized.type !== 'json') {
      return;
    }
    expect(initialized.body).toMatchObject({
      result: { protocolVersion: PROTOCOL_2025, serverInfo: { name: 'mnem-steward' } },
    });

    const listed = await handleMcpRequest({
      request: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      memory: deps.memory,
      principal,
      protocolVersion: PROTOCOL_2025,
    });
    expect(listed.type).toBe('json');
    if (listed.type !== 'json') {
      return;
    }
    const tools = (listed.body as { result: { tools: { name: string }[] } }).result.tools;
    expect(tools.map((tool) => tool.name)).toContain('memory_search');
  });

  it('treats notifications as silent', async () => {
    const { deps, principal } = await testPrincipal();
    const outcome = await handleMcpRequest({
      request: { jsonrpc: '2.0', method: 'notifications/initialized' },
      memory: deps.memory,
      principal,
      protocolVersion: PROTOCOL_2026,
    });
    expect(outcome).toEqual({ type: 'notification' });
  });
});

describe('stdio MCP', () => {
  it('requires MNEM_ACCESS_TOKEN', () => {
    expect(() => readAccessToken({})).toThrow(/MNEM_ACCESS_TOKEN/);
  });

  it('round-trips initialize, tools/list, and tools/call without audit on stdout', async () => {
    const env = testEnv();
    const auditLines: string[] = [];
    const deps = createGatewayDeps(env, {
      audit: createStdoutAuditSink((line) => {
        auditLines.push(String(line));
      }),
    });
    const secret = env.localJwtSecret;
    if (secret === undefined) {
      throw new Error('expected local JWT secret');
    }
    const token = await issueLocalAccessToken({
      secret,
      issuer: env.tokenIssuer,
      audience: env.tokenAudience,
      subject: 'stdio-user',
      scopes: [...OAUTH_SCOPES],
    });
    const principal = await deps.verifier.verify(`Bearer ${token}`);

    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    const server = runStdioServer({
      memory: deps.memory,
      principal,
      input,
      output,
    });

    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_2025,
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      })}\n`,
    );
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    input.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'memory_remember',
          arguments: {
            context: 'personal',
            kind: 'fact',
            classification: 'internal',
            fact: 'stdio prefers dual transport',
          },
        },
      })}\n`,
    );
    input.end();

    await server;

    const text = Buffer.concat(chunks).toString('utf8');
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    expect(lines).toHaveLength(3);

    const initialize = JSON.parse(lines[0]) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(initialize.result.protocolVersion).toBe(PROTOCOL_2025);
    expect(initialize.result.serverInfo.name).toBe('mnem-steward');

    const listed = JSON.parse(lines[1]) as { result: { tools: { name: string }[] } };
    expect(listed.result.tools.map((tool) => tool.name)).toContain('memory_remember');

    const called = JSON.parse(lines[2]) as {
      result: { isError: boolean; structuredContent: { fact: string } };
    };
    expect(called.result.isError).toBe(false);
    expect(called.result.structuredContent.fact).toContain('dual transport');

    expect(text).not.toMatch(/"action":"remember"/u);
    expect(auditLines.some((line) => line.includes('"action":"remember"'))).toBe(true);
  });

  it('rejects invalid JSON with a parse error on the protocol stream', async () => {
    const { deps, principal } = await testPrincipal();
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    const server = runStdioServer({
      memory: deps.memory,
      principal,
      input,
      output,
    });
    input.write('not-json\n');
    input.end();
    await server;

    const body = JSON.parse(Buffer.concat(chunks).toString('utf8').trim()) as {
      error: { code: number };
    };
    expect(body.error.code).toBe(-32700);
  });
});

describe('createGatewayDeps audit injection', () => {
  it('accepts an in-memory audit sink', async () => {
    const audit = createInMemoryAuditSink();
    const env = testEnv();
    const deps = createGatewayDeps(env, { audit });
    const secret = env.localJwtSecret;
    if (secret === undefined) {
      throw new Error('expected local JWT secret');
    }
    const token = await issueLocalAccessToken({
      secret,
      issuer: env.tokenIssuer,
      audience: env.tokenAudience,
      subject: 'audit',
      scopes: [...OAUTH_SCOPES],
    });
    const principal = await deps.verifier.verify(`Bearer ${token}`);
    await deps.memory.remember(
      {
        principal,
        context: 'personal',
        kind: 'fact',
        classification: 'internal',
        fact: 'audit sink works',
      },
      { protocol: 'mcp' },
    );
    expect(audit.events().some((event) => event.action === 'remember')).toBe(true);
  });
});
