import type { AppEnv } from '../app-env.js';
import type { TokenVerifier } from '@enterprise-memory/auth';
import type { MiddlewareHandler } from 'hono';

export function wwwAuthenticate(publicBaseUrl: string): string {
  return `Bearer realm="enterprise-memory", resource_metadata="${publicBaseUrl}/.well-known/oauth-protected-resource"`;
}

export function requireAuth(verifier: TokenVerifier): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const principal = await verifier.verify(context.req.header('Authorization'));
    context.set('principal', principal);
    await next();
  };
}
