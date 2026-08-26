import {
  MemoryDomainError,
  OAUTH_SCOPES,
  parseOAuthScopes,
  principalIdFromOidc,
} from '@mnem-steward/core';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

import type { OAuthScope, Principal } from '@mnem-steward/core';

export type LocalIssuerConfig = {
  readonly secret: Uint8Array;
  readonly issuer: string;
  readonly audience: string | readonly string[];
};

export type TokenVerifier = {
  verify(authorizationHeader: string | undefined): Promise<Principal>;
};

const BEARER = /^Bearer\s+(\S+)/iu;

export async function issueLocalAccessToken(input: {
  secret: Uint8Array;
  issuer: string;
  audience: string;
  subject: string;
  scopes: readonly OAuthScope[];
  expiresInSeconds?: number;
}): Promise<string> {
  const expiresInSeconds = input.expiresInSeconds ?? 3600;
  return new SignJWT({ scope: input.scopes.join(' ') })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setSubject(input.subject)
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .setJti(crypto.randomUUID())
    .sign(input.secret);
}

export function createLocalHs256Verifier(config: LocalIssuerConfig): TokenVerifier {
  return createJwtVerifier(config.secret, {
    issuer: config.issuer,
    audience: config.audience,
    algorithms: ['HS256'],
  });
}

export function createRemoteJwksVerifier(input: {
  jwksUrl: string;
  issuer: string;
  audience: string | readonly string[];
}): TokenVerifier {
  return createJwtVerifier(createRemoteJWKSet(new URL(input.jwksUrl)), {
    issuer: input.issuer,
    audience: input.audience,
  });
}

export function buildProtectedResourceMetadata(input: {
  resource: string;
  authorizationServers: readonly string[];
  scopesSupported?: readonly OAuthScope[];
}): {
  resource: string;
  authorization_servers: readonly string[];
  bearer_methods_supported: readonly ['header'];
  scopes_supported: readonly OAuthScope[];
} {
  return {
    resource: input.resource,
    authorization_servers: input.authorizationServers,
    bearer_methods_supported: ['header'],
    scopes_supported: input.scopesSupported ?? OAUTH_SCOPES,
  };
}

/**
 * RFC 9728 §3.1: insert `/.well-known/oauth-protected-resource` between the
 * host and any path/query of the protected resource identifier.
 */
export function protectedResourceMetadataPath(resourceUrl: string): string {
  const { pathSuffix } = wellKnownParts(resourceUrl);
  return `/.well-known/oauth-protected-resource${pathSuffix}`;
}

export function protectedResourceMetadataUrl(resourceUrl: string): string {
  const { origin, pathSuffix } = wellKnownParts(resourceUrl);
  return `${origin}/.well-known/oauth-protected-resource${pathSuffix}`;
}

function wellKnownParts(resourceUrl: string): { origin: string; pathSuffix: string } {
  let url: URL;
  try {
    url = new URL(resourceUrl);
  } catch {
    throw new Error(`Invalid protected resource URL: ${resourceUrl}`);
  }
  return {
    origin: url.origin,
    pathSuffix: url.pathname === '/' ? '' : url.pathname.replace(/\/$/u, ''),
  };
}

export function buildAuthorizationServerMetadata(input: {
  issuer: string;
  tokenEndpoint: string;
}): {
  issuer: string;
  token_endpoint: string;
  grant_types_supported: readonly string[];
  token_endpoint_auth_methods_supported: readonly string[];
  scopes_supported: readonly OAuthScope[];
} {
  return {
    issuer: input.issuer,
    token_endpoint: input.tokenEndpoint,
    grant_types_supported: ['client_credentials'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: OAUTH_SCOPES,
  };
}

function createJwtVerifier(
  key: Parameters<typeof jwtVerify>[1],
  options: { issuer: string; audience: string | readonly string[]; algorithms?: string[] },
): TokenVerifier {
  return {
    async verify(authorizationHeader: string | undefined): Promise<Principal> {
      const token = bearerToken(authorizationHeader);
      try {
        const { payload } = await jwtVerify(token, key, {
          issuer: options.issuer,
          audience: [...asAudienceList(options.audience)],
          algorithms: options.algorithms,
        });
        return principalFromPayload(payload.iss ?? options.issuer, payload.sub, payload['scope']);
      } catch (error) {
        if (error instanceof MemoryDomainError) {
          throw error;
        }
        throw new MemoryDomainError('unauthenticated', 'Access token is invalid');
      }
    },
  };
}

function asAudienceList(audience: string | readonly string[]): readonly string[] {
  return typeof audience === 'string' ? [audience] : audience;
}

function bearerToken(authorizationHeader: string | undefined): string {
  if (authorizationHeader === undefined) {
    throw new MemoryDomainError('unauthenticated', 'Missing Authorization header');
  }
  const match = BEARER.exec(authorizationHeader);
  if (match === null) {
    throw new MemoryDomainError('unauthenticated', 'Authorization header must be a Bearer token');
  }
  return match[1];
}

function principalFromPayload(issuer: string, subject: unknown, scope: unknown): Principal {
  if (typeof subject !== 'string' || subject.trim() === '') {
    throw new MemoryDomainError('unauthenticated', 'Token is missing sub');
  }
  const scopeClaim = typeof scope === 'string' ? scope : undefined;
  return {
    id: principalIdFromOidc(issuer, subject),
    issuer,
    subject,
    scopes: parseOAuthScopes(scopeClaim),
  };
}
