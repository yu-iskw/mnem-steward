import {
  createLocalHs256Verifier,
  createRemoteJwksVerifier,
  issueLocalAccessToken,
} from '@enterprise-memory/auth';
import {
  createInMemoryAuditSink,
  createInMemoryMemoryStore,
  createMemoryService,
  createRandomIdGenerator,
  createStdoutAuditSink,
  systemClock,
} from '@enterprise-memory/core';
import { createGoogleMemoryStore } from '@enterprise-memory/google-memory';

import type { GatewayEnv } from './env.js';
import type { TokenVerifier } from '@enterprise-memory/auth';
import type { MemoryService } from '@enterprise-memory/core';

export type GatewayDeps = {
  readonly env: GatewayEnv;
  readonly memory: MemoryService;
  readonly verifier: TokenVerifier;
  readonly issueLocalAccessToken:
    | typeof issueLocalAccessToken
    | undefined;
};

export function createGatewayDeps(env: GatewayEnv): GatewayDeps {
  const clock = systemClock;
  const store = createStore(env);
  const memory = createMemoryService({
    store,
    audit: env.authMode === 'local' ? createInMemoryAuditSink() : createStdoutAuditSink(),
    clock,
  });
  const verifier = createVerifier(env);
  return {
    env,
    memory,
    verifier,
    issueLocalAccessToken: env.authMode === 'local' ? issueLocalAccessToken : undefined,
  };
}

function createStore(env: GatewayEnv) {
  switch (env.memoryStore) {
    case 'in-memory':
      return createInMemoryMemoryStore({ clock: systemClock, ids: createRandomIdGenerator() });
    case 'google':
      if (env.google === undefined) {
        throw new Error('Google Memory Bank config missing');
      }
      return createGoogleMemoryStore({
        config: env.google,
        http: { fetch: (url, init) => fetch(url, init) },
        tokens: {
          getAccessToken: () => googleAccessToken(),
        },
      });
    default: {
      const exhaustive: never = env.memoryStore;
      return exhaustive;
    }
  }
}

function createVerifier(env: GatewayEnv): TokenVerifier {
  switch (env.authMode) {
    case 'local':
      if (env.localJwtSecret === undefined) {
        throw new Error('LOCAL_JWT_SECRET missing');
      }
      return createLocalHs256Verifier({
        secret: env.localJwtSecret,
        issuer: env.tokenIssuer,
        audience: env.tokenAudience,
      });
    case 'jwks':
      if (env.jwksUrl === undefined) {
        throw new Error('AUTH_JWKS_URL missing');
      }
      return createRemoteJwksVerifier({
        jwksUrl: env.jwksUrl,
        issuer: env.tokenIssuer,
        audience: env.tokenAudience,
      });
    default: {
      const exhaustive: never = env.authMode;
      return exhaustive;
    }
  }
}

async function googleAccessToken(): Promise<string> {
  const fromEnv = process.env['GOOGLE_ACCESS_TOKEN'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv;
  }
  const metadata = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!metadata.ok) {
    throw new Error(`Metadata token server returned ${String(metadata.status)}`);
  }
  const body = (await metadata.json()) as { access_token?: unknown };
  if (typeof body.access_token !== 'string' || body.access_token.trim() === '') {
    throw new Error('Metadata token server omitted access_token');
  }
  return body.access_token;
}
