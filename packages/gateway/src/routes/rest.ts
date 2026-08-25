import {
  EMPLOYEE_AGENT_SCHEMA,
  parseClassification,
  parseMemoryKind,
  parseTtl,
} from '@enterprise-memory/core';

import {
  asObject,
  optionalKind,
  optionalNumber,
  optionalString,
  parseContext,
  readJson,
  requiredString,
} from '../parse-memory-input.js';

import type { MemoryApp } from '../app-env.js';
import type { MemoryService } from '@enterprise-memory/core';

export function mountRest(app: MemoryApp, memory: MemoryService): void {
  app.post('/v1/memories:search', async (context) => {
    const principal = context.get('principal');
    const body = asObject(await readJson(context));
    const outcome = await memory.search(
      {
        principal,
        context: parseContext(body['context']),
        text: optionalString(body['text']),
        kind: optionalKind(body['kind']),
        limit: optionalNumber(body['limit']),
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
    const body = asObject(await readJson(context));
    const record = await memory.remember(
      {
        principal,
        context: parseContext(body['context']),
        kind: parseMemoryKind(requiredString(body['kind'], 'kind')),
        classification: parseClassification(
          requiredString(body['classification'], 'classification'),
        ),
        fact: requiredString(body['fact'], 'fact'),
        ttl: parseTtl(body['ttl']),
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
    if (schema !== EMPLOYEE_AGENT_SCHEMA) {
      return context.json({ error: 'invalid_input', message: 'Unknown profile schema' }, 400);
    }
    const outcome = await memory.getProfile(EMPLOYEE_AGENT_SCHEMA, principal, { protocol: 'rest' });
    if (outcome.status === 'unavailable') {
      return context.json(outcome, 503);
    }
    return context.json(outcome);
  });
}
