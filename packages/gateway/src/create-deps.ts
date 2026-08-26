import { createLocalHs256Verifier, createRemoteJwksVerifier } from '@mnem-steward/auth';
import {
  createInMemoryMemoryStore,
  createMemoryService,
  createRandomIdGenerator,
  createStdoutAuditSink,
  systemClock,
} from '@mnem-steward/core';
import {
  createGoogleAccessTokenProvider,
  createGoogleMemoryStore,
  formatGoogleCredentialDescription,
} from '@mnem-steward/google-memory';

import { mcpProfileMount } from './mcp/profiles.js';

import type { GatewayEnv } from './env.js';
import type { McpProfileMount } from './mcp/profiles.js';
import type { TokenVerifier } from '@mnem-steward/auth';
import type { AuditSink, MemoryService } from '@mnem-steward/core';
import type { DescribedAccessTokenProvider } from '@mnem-steward/google-memory';

export type GatewayDeps = {
  readonly env: GatewayEnv;
  readonly memory: MemoryService;
  readonly verifier: TokenVerifier;
  readonly mcpMounts: readonly McpProfileMount[];
};

type CreateGatewayDepsOptions = {
  readonly audit?: AuditSink;
  readonly logGoogleCredentials?: (line: string) => void;
};

export function createGatewayDeps(
  env: GatewayEnv,
  options: CreateGatewayDepsOptions = {},
): GatewayDeps {
  const clock = systemClock;
  const googleCredentials = createGoogleCredentials(env, options.logGoogleCredentials);
  const store = createStore(env, googleCredentials);
  const memory = createMemoryService({
    store,
    audit: options.audit ?? createStdoutAuditSink(),
    clock,
  });
  const mcpMounts = env.mcpProfiles.map((id) => mcpProfileMount(env.publicBaseUrl, id));
  const verifier = createVerifier(env, mcpMounts);
  return {
    env,
    memory,
    verifier,
    mcpMounts,
  };
}

function createGoogleCredentials(
  env: GatewayEnv,
  logGoogleCredentials: ((line: string) => void) | undefined,
): DescribedAccessTokenProvider | undefined {
  if (env.memoryStore !== 'google' || env.googleCredentialMode === undefined) {
    return undefined;
  }
  if (
    env.googleAccessToken !== undefined &&
    env.googleCredentialMode === 'adc' &&
    logGoogleCredentials !== undefined
  ) {
    logGoogleCredentials('google_credentials note=GOOGLE_ACCESS_TOKEN is ignored in adc mode');
  }
  const provider = createGoogleAccessTokenProvider({
    mode: env.googleCredentialMode,
    envToken: env.googleAccessToken,
    impersonateServiceAccount: env.googleImpersonateServiceAccount,
  });
  const credentialLog = formatGoogleCredentialDescription(provider.describeCredentials());
  if (credentialLog !== undefined) {
    logGoogleCredentials?.(credentialLog);
  }
  return provider;
}

function createStore(env: GatewayEnv, googleCredentials: DescribedAccessTokenProvider | undefined) {
  switch (env.memoryStore) {
    case 'in-memory':
      return createInMemoryMemoryStore({ clock: systemClock, ids: createRandomIdGenerator() });
    case 'google':
      if (env.google === undefined || googleCredentials === undefined) {
        throw new Error('Google Memory Bank config missing');
      }
      return createGoogleMemoryStore({
        config: env.google,
        http: { fetch },
        tokens: googleCredentials,
      });
    default: {
      const exhaustive: never = env.memoryStore;
      return exhaustive;
    }
  }
}

function createVerifier(env: GatewayEnv, mcpMounts: readonly McpProfileMount[]): TokenVerifier {
  const audiences = tokenAudiences(env.tokenAudience, mcpMounts);
  switch (env.authMode) {
    case 'local':
      if (env.localJwtSecret === undefined) {
        throw new Error('LOCAL_JWT_SECRET missing');
      }
      return createLocalHs256Verifier({
        secret: env.localJwtSecret,
        issuer: env.tokenIssuer,
        audience: audiences,
      });
    case 'jwks':
      if (env.jwksUrl === undefined) {
        throw new Error('AUTH_JWKS_URL missing');
      }
      return createRemoteJwksVerifier({
        jwksUrl: env.jwksUrl,
        issuer: env.tokenIssuer,
        audience: audiences,
      });
    default: {
      const exhaustive: never = env.authMode;
      return exhaustive;
    }
  }
}

/** REST base audience plus each mounted MCP profile resource identifier. */
function tokenAudiences(
  tokenAudience: string,
  mcpMounts: readonly McpProfileMount[],
): readonly string[] {
  const audiences = [tokenAudience];
  for (const mount of mcpMounts) {
    if (!audiences.includes(mount.resource)) {
      audiences.push(mount.resource);
    }
  }
  return audiences;
}
