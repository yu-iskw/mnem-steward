import { createInterface } from 'node:readline';

import {
  handleMcpRequest,
  protocolVersionFromInitialize,
  PROTOCOL_2025,
} from './mcp/handle-request.js';
import { jsonRpcError, parseJsonRpc } from './mcp/json-rpc.js';

import type { MemoryService, Principal } from '@mnem-steward/core';
import type { Readable, Writable } from 'node:stream';

export type StdioServerOptions = {
  readonly memory: MemoryService;
  readonly principal: Principal;
  readonly input?: Readable;
  readonly output?: Writable;
};

/**
 * Runs newline-delimited JSON-RPC MCP over the given streams (default stdin/stdout).
 * Never writes logs to the protocol output stream.
 */
export async function runStdioServer(options: StdioServerOptions): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  let protocolVersion = PROTOCOL_2025;

  const rl = createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }

    let body: unknown;
    try {
      body = JSON.parse(trimmed) as unknown;
    } catch {
      writeLine(output, jsonRpcError(null, -32700, 'Parse error'));
      continue;
    }

    const parsed = parseJsonRpc(body);
    if ('error' in parsed) {
      writeLine(output, jsonRpcError(null, -32600, parsed.error));
      continue;
    }

    if (parsed.method === 'initialize') {
      protocolVersion = protocolVersionFromInitialize(parsed.params);
    }

    const outcome = await handleMcpRequest({
      request: parsed,
      memory: options.memory,
      principal: options.principal,
      protocolVersion,
    });

    switch (outcome.type) {
      case 'notification':
        break;
      case 'unauthorized':
        writeLine(
          output,
          jsonRpcError(parsed.id ?? null, -32001, outcome.message, { code: outcome.code }),
        );
        break;
      case 'json':
        writeLine(output, outcome.body);
        break;
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }
}

export function readAccessToken(env: Record<string, string | undefined>): string {
  const token = env['MNEM_ACCESS_TOKEN'];
  if (token === undefined || token.trim() === '') {
    throw new Error('MNEM_ACCESS_TOKEN is required for STDIO MCP');
  }
  return token.trim();
}

function writeLine(output: Writable, value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`);
}
