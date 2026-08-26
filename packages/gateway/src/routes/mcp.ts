import {
  handleMcpRequest,
  PROTOCOL_2025,
  PROTOCOL_2026,
  validate2026Headers,
} from '../mcp/handle-request.js';
import { jsonRpcError, parseJsonRpc } from '../mcp/json-rpc.js';

import type { MemoryApp } from '../app-env.js';
import type { MemoryService } from '@mnem-steward/core';

export function mountMcp(app: MemoryApp, memory: MemoryService): void {
  app.get('/mcp', (context) => context.body('Method Not Allowed', 405));

  app.post('/mcp', async (context) => {
    const origin = context.req.header('Origin');
    if (origin !== undefined && !isAllowedOrigin(origin, context.req.url)) {
      return context.json({ error: 'forbidden', message: 'Invalid Origin' }, 403);
    }

    const protocolVersion = context.req.header('MCP-Protocol-Version') ?? PROTOCOL_2025;
    const parsed = parseJsonRpc(await context.req.json());
    if ('error' in parsed) {
      return context.json(jsonRpcError(null, -32600, parsed.error), 400);
    }

    if (protocolVersion === PROTOCOL_2026) {
      const headerError = validate2026Headers(context.req.header.bind(context.req), parsed);
      if (headerError !== undefined) {
        return context.json(jsonRpcError(parsed.id ?? null, -32600, headerError), 400);
      }
    }

    const outcome = await handleMcpRequest({
      request: parsed,
      memory,
      principal: context.get('principal'),
      protocolVersion,
    });

    switch (outcome.type) {
      case 'notification':
        return context.body(null, 202);
      case 'unauthorized':
        return context.json({ error: outcome.code, message: outcome.message }, 401);
      case 'json':
        return context.json(outcome.body, outcome.status);
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  });
}

function isAllowedOrigin(origin: string, requestUrl: string): boolean {
  let requestOrigin = '';
  try {
    requestOrigin = new URL(requestUrl).origin;
  } catch {
    requestOrigin = '';
  }
  if (origin === requestOrigin) {
    return true;
  }
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}
