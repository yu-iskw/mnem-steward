import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  issueLocalAccessToken,
} from '@mnem-steward/auth';
import { OAUTH_SCOPES, parseOAuthScopes } from '@mnem-steward/core';

import type { MemoryApp } from '../app-env.js';
import type { GatewayDeps } from '../create-deps.js';

type TokenBody = {
  grant_type?: unknown;
  sub?: unknown;
  scope?: unknown;
};

export function mountOauth(app: MemoryApp, deps: GatewayDeps): void {
  const restResource = deps.env.publicBaseUrl;
  const mcpResource = `${deps.env.publicBaseUrl}/mcp`;
  const authorizationServers = [deps.env.tokenIssuer];

  app.get('/.well-known/oauth-protected-resource', (context) =>
    context.json(buildProtectedResourceMetadata({ resource: restResource, authorizationServers })),
  );
  app.get('/.well-known/oauth-protected-resource/mcp', (context) =>
    context.json(buildProtectedResourceMetadata({ resource: mcpResource, authorizationServers })),
  );

  if (deps.env.authMode !== 'local' || deps.env.localJwtSecret === undefined) {
    return;
  }

  const secret = deps.env.localJwtSecret;

  app.get('/.well-known/oauth-authorization-server', (context) =>
    context.json(
      buildAuthorizationServerMetadata({
        issuer: deps.env.tokenIssuer,
        tokenEndpoint: `${deps.env.publicBaseUrl}/oauth/token`,
      }),
    ),
  );

  app.post('/oauth/token', async (context) => {
    const body: TokenBody = await context.req.json();
    if (body.grant_type !== 'client_credentials') {
      return context.json({ error: 'unsupported_grant_type' }, 400);
    }
    if (typeof body.sub !== 'string' || body.sub.trim() === '') {
      return context.json({ error: 'invalid_request', error_description: 'sub is required' }, 400);
    }
    const scopes =
      typeof body.scope === 'string' && body.scope.trim() !== ''
        ? parseOAuthScopes(body.scope)
        : [...OAUTH_SCOPES];
    const accessToken = await issueLocalAccessToken({
      secret,
      issuer: deps.env.tokenIssuer,
      audience: deps.env.tokenAudience,
      subject: body.sub,
      scopes,
    });
    return context.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: scopes.join(' '),
    });
  });
}
