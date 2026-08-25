import {
  MemoryDomainError,
  OAUTH_SCOPES,
  parseOAuthScopes,
  principalIdFromOidc,
} from '@enterprise-memory/core';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

import type { OAuthScope, Principal } from '@enterprise-memory/core';

export type LocalIssuerConfig = {
  readonly secret: Uint8Array;
  readonly issuer: string;
  readonly audience: string;
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
  audience: string;
}): TokenVerifier {
  return createJwtVerifier(createRemoteJWKSet(new URL(input.jwksUrl)), {
    issuer: input.issuer,
    audience: input.audience,
  });
}

export function buildProtectedResourceMetadata(input: {
  resource: string;
  authorizationServers: readonly string[];
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
    scopes_supported: OAUTH_SCOPES,
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
  options: { issuer: string; audience: string; algorithms?: string[] },
): TokenVerifier {
  return {
    async verify(authorizationHeader: string | undefined): Promise<Principal> {
      const token = bearerToken(authorizationHeader);
      try {
        const { payload } = await jwtVerify(token, key, options);
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
