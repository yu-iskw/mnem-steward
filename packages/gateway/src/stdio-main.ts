import { createStdoutAuditSink } from '@mnem-steward/core';

import { createGatewayDeps } from './create-deps.js';
import { parseEnv } from './env.js';
import { readAccessToken, runStdioServer } from './stdio-server.js';

async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const token = readAccessToken(process.env);
  const deps = createGatewayDeps(env, {
    audit: createStdoutAuditSink((line) => {
      process.stderr.write(`${line}\n`);
    }),
    logGoogleCredentials: (line) => {
      process.stderr.write(`${line}\n`);
    },
  });
  const principal = await deps.verifier.verify(`Bearer ${token}`);
  await runStdioServer({
    memory: deps.memory,
    principal,
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'STDIO MCP failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
