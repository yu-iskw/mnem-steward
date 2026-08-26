import { protectedResourceMetadataUrl } from '@mnem-steward/auth';
import { isMemoryDomainError } from '@mnem-steward/core';
import { Hono } from 'hono';

import { domainErrorStatus } from './http-error.js';
import { requireAuth, wwwAuthenticate } from './middleware/require-auth.js';
import { mountMcp } from './routes/mcp.js';
import { mountOauth } from './routes/oauth.js';
import { mountRest } from './routes/rest.js';

import type { AppEnv } from './app-env.js';
import type { GatewayDeps } from './create-deps.js';

export function createApp(deps: GatewayDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const restMetadataUrl = protectedResourceMetadataUrl(deps.env.publicBaseUrl);

  app.onError((error, context) => {
    if (isMemoryDomainError(error)) {
      const status = domainErrorStatus(error);
      if (status === 401) {
        const metadataUrl = context.get('resourceMetadataUrl') ?? restMetadataUrl;
        context.header('WWW-Authenticate', wwwAuthenticate(metadataUrl));
      }
      return context.json({ error: error.code, message: error.message }, status);
    }
    return context.json({ error: 'internal', message: 'Internal error' }, 500);
  });

  app.get('/healthz', (context) => context.json({ status: 'ok' }));
  mountOauth(app, deps);
  app.use('/v1/*', requireAuth(deps.verifier, restMetadataUrl));
  for (const mount of deps.mcpMounts) {
    app.use(mount.profile.path, requireAuth(deps.verifier, mount.metadataUrl));
  }
  mountRest(app, deps.memory);
  mountMcp(app, deps.memory, deps.mcpMounts);
  return app;
}
