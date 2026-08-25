import {
  isMemoryDomainError,
  MemoryDomainError,
  parseClassification,
  parseMemoryKind,
} from '@enterprise-memory/core';

import type { MemoryApp } from '../app-env.js';
import type { MemoryService } from '@enterprise-memory/core';

type SearchBody = {
  context?: unknown;
  text?: unknown;
  kind?: unknown;
  limit?: unknown;
};

type RememberBody = {
  context?: unknown;
  kind?: unknown;
  classification?: unknown;
  fact?: unknown;
  ttl?: unknown;
};

export function mountRest(app: MemoryApp, memory: MemoryService): void {
  app.post('/v1/memories:search', async (context) => {
    const principal = context.get('principal');
    const body = (await readJson(context)) as SearchBody;
    const outcome = await memory.search(
      {
        principal,
        context: parseContext(body.context),
        text: optionalString(body.text),
        kind: optionalKind(body.kind),
        limit: optionalNumber(body.limit),
      },
      { protocol: 'rest' },
    );
    if (outcome.status === 'unavailable') {
      return context.json(outcome, 503);
    }
    return context.json(outcome);
  });

  app.post('/v1/memories', async (context) => {
    const principal = context.get('principal');
    const body = (await readJson(context)) as RememberBody;
    const record = await memory.remember(
      {
        principal,
        context: parseContext(body.context),
        kind: parseMemoryKind(requiredString(body.kind, 'kind')),
        classification: parseClassification(requiredString(body.classification, 'classification')),
        fact: requiredString(body.fact, 'fact'),
        ttl: parseTtl(body.ttl),
      },
      { protocol: 'rest' },
    );
    return context.json(record, 201);
  });

  app.delete('/v1/memories/:id', async (context) => {
    const principal = context.get('principal');
    await memory.forget(context.req.param('id'), principal, { protocol: 'rest' });
    return context.body(null, 204);
  });

  app.get('/v1/memories/:id/history', async (context) => {
    const principal = context.get('principal');
    const outcome = await memory.history(context.req.param('id'), principal, { protocol: 'rest' });
    if (outcome.status === 'unavailable') {
      return context.json(outcome, 503);
    }
    return context.json(outcome);
  });

  app.get('/v1/profiles/:schema', async (context) => {
    const principal = context.get('principal');
    const schema = context.req.param('schema');
    if (schema !== 'employee-agent') {
      return context.json({ error: 'invalid_input', message: 'Unknown profile schema' }, 400);
    }
    const outcome = await memory.getProfile('employee-agent', principal, { protocol: 'rest' });
    if (outcome.status === 'unavailable') {
      return context.json(outcome, 503);
    }
    return context.json(outcome);
  });
}

export function domainErrorStatus(error: unknown): 400 | 401 | 403 | 404 | 500 | 503 {
  if (!isMemoryDomainError(error)) {
    return 500;
  }
  switch (error.code) {
    case 'unauthenticated':
      return 401;
    case 'invalid_input':
      return 400;
    case 'not_found':
      return 404;
    case 'unavailable':
      return 503;
    case 'forbidden':
    case 'namespace_denied':
    case 'secret_detected':
    case 'prohibited_classification':
      return 403;
    default: {
      const exhaustive: never = error.code;
      return exhaustive;
    }
  }
}

async function readJson(context: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return {};
  }
}

function parseContext(value: unknown): 'personal' | 'current_project' {
  if (value === undefined || value === 'personal') {
    return 'personal';
  }
  if (value === 'current_project') {
    return 'current_project';
  }
  throw new MemoryDomainError('invalid_input', 'context must be personal or current_project');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function optionalKind(value: unknown) {
  return typeof value === 'string' ? parseMemoryKind(value) : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MemoryDomainError('invalid_input', `Missing ${field}`);
  }
  return value;
}

function parseTtl(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'object' && 'expireAt' in value && typeof value.expireAt === 'string') {
    return { expireAt: value.expireAt };
  }
  if (typeof value === 'object' && 'ttlSeconds' in value && typeof value.ttlSeconds === 'number') {
    return { ttlSeconds: value.ttlSeconds };
  }
  return undefined;
}
