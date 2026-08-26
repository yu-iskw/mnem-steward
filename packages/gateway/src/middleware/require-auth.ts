import type { AppEnv } from '../app-env.js';
import type { TokenVerifier } from '@mnem-steward/auth';
import type { MiddlewareHandler } from 'hono';

export function wwwAuthenticate(resourceMetadataUrl: string): string {
  return `Bearer realm="mnem-steward", resource_metadata="${resourceMetadataUrl}"`;
}

export function requireAuth(
  verifier: TokenVerifier,
  resourceMetadataUrl: string,
): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    context.set('resourceMetadataUrl', resourceMetadataUrl);
    const principal = await verifier.verify(context.req.header('Authorization'));
    context.set('principal', principal);
    await next();
  };
}
