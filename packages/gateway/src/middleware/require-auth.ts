import type { AppEnv } from '../app-env.js';
import type { TokenVerifier } from '@mnem-steward/auth';
import type { MiddlewareHandler } from 'hono';

export function wwwAuthenticate(publicBaseUrl: string): string {
  return `Bearer realm="mnem-steward", resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`;
}

export function requireAuth(verifier: TokenVerifier): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const principal = await verifier.verify(context.req.header('Authorization'));
    context.set('principal', principal);
    await next();
  };
}
