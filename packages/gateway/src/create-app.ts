import { isMemoryDomainError } from '@enterprise-memory/core';
import { Hono } from 'hono';

import { requireAuth, wwwAuthenticate } from './middleware/require-auth.js';
import { mountMcp } from './routes/mcp.js';
import { mountOauth } from './routes/oauth.js';
import { domainErrorStatus, mountRest } from './routes/rest.js';

import type { AppEnv } from './app-env.js';
import type { GatewayDeps } from './create-deps.js';

export function createApp(deps: GatewayDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError((error, context) => {
    if (isMemoryDomainError(error)) {
      const status = domainErrorStatus(error);
      if (status === 401) {
        context.header('WWW-Authenticate', wwwAuthenticate(deps.env.publicBaseUrl));
      }
      return context.json({ error: error.code, message: error.message }, status);
    }
    return context.json({ error: 'internal', message: 'Internal error' }, 500);
  });

  app.get('/healthz', (context) => context.json({ status: 'ok' }));
  mountOauth(app, deps);
  app.use('/v1/*', requireAuth(deps.verifier, deps.env.publicBaseUrl));
  app.use('/mcp', requireAuth(deps.verifier, deps.env.publicBaseUrl));
  mountRest(app, deps.memory);
  mountMcp(app, deps.memory);
  return app;
}
