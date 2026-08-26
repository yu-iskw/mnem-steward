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
});
