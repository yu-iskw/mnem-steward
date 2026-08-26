import { googleMemoryConfigFromEnv, isGoogleMemoryConfigured } from '@mnem-steward/google-memory';

import { parseMcpProfiles } from './mcp/profiles.js';

import type { McpProfileId } from './mcp/profiles.js';
import type { GoogleMemoryConfig } from '@mnem-steward/google-memory';

export type AuthMode = 'local' | 'jwks';
export type MemoryStoreMode = 'in-memory' | 'google';

export type GatewayEnv = {
  readonly port: number;
  readonly publicBaseUrl: string;
  readonly authMode: AuthMode;
  readonly memoryStore: MemoryStoreMode;
  readonly tokenIssuer: string;
  readonly tokenAudience: string;
  readonly localJwtSecret: Uint8Array | undefined;
  readonly jwksUrl: string | undefined;
  readonly google: GoogleMemoryConfig | undefined;
  readonly mcpProfiles: readonly McpProfileId[];
};

export function parseEnv(env: Record<string, string | undefined>): GatewayEnv {
  const publicBaseUrl = required(env['PUBLIC_BASE_URL'], 'PUBLIC_BASE_URL').replace(/\/$/u, '');
  const authMode = parseAuthMode(env['AUTH_MODE'] ?? 'local');
  const memoryStore = parseMemoryStore(env['MEMORY_STORE'] ?? 'in-memory');
  const tokenIssuer = env['AUTH_ISSUER'] ?? publicBaseUrl;
  const tokenAudience = env['AUTH_AUDIENCE'] ?? publicBaseUrl;
  const port = Number.parseInt(env['PORT'] ?? '8080', 10);
  if (authMode === 'local') {
    assertLocalAuthAllowed(publicBaseUrl, env['ALLOW_LOCAL_AUTH']);
  }
  return {
    port: Number.isFinite(port) ? port : 8080,
    publicBaseUrl,
    authMode,
    memoryStore,
    tokenIssuer,
    tokenAudience,
    localJwtSecret:
      authMode === 'local'
        ? encodeSecret(required(env['LOCAL_JWT_SECRET'], 'LOCAL_JWT_SECRET'))
        : undefined,
    jwksUrl: authMode === 'jwks' ? required(env['AUTH_JWKS_URL'], 'AUTH_JWKS_URL') : undefined,
    google: memoryStore === 'google' ? googleConfig(env) : undefined,
    mcpProfiles: parseMcpProfiles(env['MNEM_STEWARD_MCP_PROFILES']),
  };
}

function parseAuthMode(value: string): AuthMode {
  switch (value) {
    case 'local':
    case 'jwks':
      return value;
    default:
      throw new Error(`Unsupported AUTH_MODE: ${value}`);
  }
}

function parseMemoryStore(value: string): MemoryStoreMode {
  switch (value) {
    case 'in-memory':
    case 'google':
      return value;
    default:
      throw new Error(`Unsupported MEMORY_STORE: ${value}`);
  }
}

function googleConfig(env: Record<string, string | undefined>): GoogleMemoryConfig {
  if (!isGoogleMemoryConfigured(env)) {
    throw new Error(
      'MEMORY_STORE=google requires GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, GOOGLE_REASONING_ENGINE_ID',
    );
  }
  return googleMemoryConfigFromEnv(env);
}

function required(value: string | undefined, key: string): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required env ${key}`);
  }
  return value;
}

function encodeSecret(secret: string): Uint8Array {
  if (secret.length < 32) {
    throw new Error('LOCAL_JWT_SECRET must be at least 32 characters');
  }
  return new TextEncoder().encode(secret);
}

function assertLocalAuthAllowed(publicBaseUrl: string, allow: string | undefined): void {
  if (allow === '1') {
    return;
  }
  let hostname: string;
  try {
    hostname = new URL(publicBaseUrl).hostname;
  } catch {
    throw new Error('PUBLIC_BASE_URL must be a valid URL');
  }
  const loopback =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1';
  if (!loopback) {
    throw new Error(
      'AUTH_MODE=local is refused unless PUBLIC_BASE_URL is localhost or ALLOW_LOCAL_AUTH=1',
    );
  }
}
