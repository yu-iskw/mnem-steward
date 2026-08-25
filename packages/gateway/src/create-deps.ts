import { createLocalHs256Verifier, createRemoteJwksVerifier } from '@mnem-steward/auth';
import {
  createInMemoryMemoryStore,
  createMemoryService,
  createRandomIdGenerator,
  createStdoutAuditSink,
  systemClock,
} from '@mnem-steward/core';
import { createAccessTokenProvider, createGoogleMemoryStore } from '@mnem-steward/google-memory';

import type { GatewayEnv } from './env.js';
import type { TokenVerifier } from '@mnem-steward/auth';
import type { MemoryService } from '@mnem-steward/core';

export type GatewayDeps = {
  readonly env: GatewayEnv;
  readonly memory: MemoryService;
  readonly verifier: TokenVerifier;
};

export function createGatewayDeps(env: GatewayEnv): GatewayDeps {
  const clock = systemClock;
  const store = createStore(env);
  const memory = createMemoryService({
    store,
    audit: createStdoutAuditSink(),
    clock,
  });
  const verifier = createVerifier(env);
  return {
    env,
    memory,
    verifier,
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
        http: { fetch },
        tokens: createAccessTokenProvider({ envToken: process.env['GOOGLE_ACCESS_TOKEN'] }),
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
