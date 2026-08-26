import { describe, expect, it } from 'vitest';

import { parseEnv } from './env.js';

describe('parseEnv', () => {
  it('parses local in-memory configuration', () => {
    const env = parseEnv({
      PUBLIC_BASE_URL: 'http://127.0.0.1:8080/',
      AUTH_MODE: 'local',
      MEMORY_STORE: 'in-memory',
      LOCAL_JWT_SECRET: 'local-dev-secret-at-least-32-bytes!',
    });
    expect(env.authMode).toBe('local');
    expect(env.publicBaseUrl).toBe('http://127.0.0.1:8080');
    expect(env.memoryStore).toBe('in-memory');
    expect(env.mcpProfiles).toEqual(['memory-reader', 'memory-steward', 'memory-governance']);
  });

  it('parses MNEM_STEWARD_MCP_PROFILES and rejects unknown ids', () => {
    const env = parseEnv({
      PUBLIC_BASE_URL: 'http://127.0.0.1:8080',
      AUTH_MODE: 'local',
      MEMORY_STORE: 'in-memory',
      LOCAL_JWT_SECRET: 'local-dev-secret-at-least-32-bytes!',
      MNEM_STEWARD_MCP_PROFILES: 'memory-reader, memory-steward',
    });
    expect(env.mcpProfiles).toEqual(['memory-reader', 'memory-steward']);
    expect(() =>
      parseEnv({
        PUBLIC_BASE_URL: 'http://127.0.0.1:8080',
        AUTH_MODE: 'local',
        MEMORY_STORE: 'in-memory',
        LOCAL_JWT_SECRET: 'local-dev-secret-at-least-32-bytes!',
        MNEM_STEWARD_MCP_PROFILES: 'memory-admin',
      }),
    ).toThrow(/Unknown MCP profile/);
  });

  it('refuses local auth on https without an override', () => {
    expect(() =>
      parseEnv({
        PUBLIC_BASE_URL: 'https://memory.company.example',
        AUTH_MODE: 'local',
        MEMORY_STORE: 'in-memory',
        LOCAL_JWT_SECRET: 'local-dev-secret-at-least-32-bytes!',
      }),
    ).toThrow(/ALLOW_LOCAL_AUTH/);
    expect(() =>
      parseEnv({
        PUBLIC_BASE_URL: 'https://mylocalhost.example',
        AUTH_MODE: 'local',
        MEMORY_STORE: 'in-memory',
        LOCAL_JWT_SECRET: 'local-dev-secret-at-least-32-bytes!',
      }),
    ).toThrow(/ALLOW_LOCAL_AUTH|localhost/);
  });

  it('requires jwks url in jwks mode', () => {
    expect(() =>
      parseEnv({
        PUBLIC_BASE_URL: 'https://memory.company.example',
        AUTH_MODE: 'jwks',
        MEMORY_STORE: 'in-memory',
      }),
    ).toThrow(/AUTH_JWKS_URL/);
  });

  it('defaults google credentials to env when GOOGLE_ACCESS_TOKEN is set', () => {
    const env = parseEnv({
      PUBLIC_BASE_URL: 'https://memory.company.example',
      AUTH_MODE: 'jwks',
      AUTH_JWKS_URL: 'https://issuer.example/jwks',
      MEMORY_STORE: 'google',
      GOOGLE_CLOUD_PROJECT: 'p',
      GOOGLE_CLOUD_LOCATION: 'eu',
      GOOGLE_REASONING_ENGINE_ID: 'eng',
      GOOGLE_ACCESS_TOKEN: 'ya29.test',
    });
    expect(env.googleCredentialMode).toBe('env');
    expect(env.googleAccessToken).toBe('ya29.test');
  });

  it('defaults google credentials to adc without an env token', () => {
    const env = parseEnv({
      PUBLIC_BASE_URL: 'https://memory.company.example',
      AUTH_MODE: 'jwks',
      AUTH_JWKS_URL: 'https://issuer.example/jwks',
      MEMORY_STORE: 'google',
      GOOGLE_CLOUD_PROJECT: 'p',
      GOOGLE_CLOUD_LOCATION: 'eu',
      GOOGLE_REASONING_ENGINE_ID: 'eng',
    });
    expect(env.googleCredentialMode).toBe('adc');
  });

  it('requires impersonation target when mode is impersonate', () => {
    expect(() =>
      parseEnv({
        PUBLIC_BASE_URL: 'https://memory.company.example',
        AUTH_MODE: 'jwks',
        AUTH_JWKS_URL: 'https://issuer.example/jwks',
        MEMORY_STORE: 'google',
        GOOGLE_CLOUD_PROJECT: 'p',
        GOOGLE_CLOUD_LOCATION: 'eu',
        GOOGLE_REASONING_ENGINE_ID: 'eng',
        GOOGLE_CREDENTIAL_MODE: 'impersonate',
      }),
    ).toThrow(/GOOGLE_IMPERSONATE_SERVICE_ACCOUNT/);
  });

  it('honors explicit adc when GOOGLE_ACCESS_TOKEN is set', () => {
    const env = parseEnv({
      PUBLIC_BASE_URL: 'https://memory.company.example',
      AUTH_MODE: 'jwks',
      AUTH_JWKS_URL: 'https://issuer.example/jwks',
      MEMORY_STORE: 'google',
      GOOGLE_CLOUD_PROJECT: 'p',
      GOOGLE_CLOUD_LOCATION: 'eu',
      GOOGLE_REASONING_ENGINE_ID: 'eng',
      GOOGLE_CREDENTIAL_MODE: 'adc',
      GOOGLE_ACCESS_TOKEN: 'ya29.test',
    });
    expect(env.googleCredentialMode).toBe('adc');
    expect(env.googleAccessToken).toBe('ya29.test');
  });

  it('parses impersonate mode with a target SA', () => {
    const env = parseEnv({
      PUBLIC_BASE_URL: 'https://memory.company.example',
      AUTH_MODE: 'jwks',
      AUTH_JWKS_URL: 'https://issuer.example/jwks',
      MEMORY_STORE: 'google',
      GOOGLE_CLOUD_PROJECT: 'p',
      GOOGLE_CLOUD_LOCATION: 'eu',
      GOOGLE_REASONING_ENGINE_ID: 'eng',
      GOOGLE_CREDENTIAL_MODE: 'impersonate',
      GOOGLE_IMPERSONATE_SERVICE_ACCOUNT: 'memory@p.iam.gserviceaccount.com',
    });
    expect(env.googleCredentialMode).toBe('impersonate');
    expect(env.googleImpersonateServiceAccount).toBe('memory@p.iam.gserviceaccount.com');
  });
});
