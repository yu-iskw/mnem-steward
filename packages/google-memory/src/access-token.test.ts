import { describe, expect, it, vi } from 'vitest';

import {
  createAccessTokenProvider,
  createGoogleAccessTokenProvider,
  resolveGoogleCredentialMode,
} from './access-token.js';

import type { AuthClient } from 'google-auth-library';

describe('resolveGoogleCredentialMode', () => {
  it('defaults to env when a token is present and to adc otherwise', () => {
    expect(resolveGoogleCredentialMode({ envToken: 'ya29.x' })).toBe('env');
    expect(resolveGoogleCredentialMode({})).toBe('adc');
    expect(resolveGoogleCredentialMode({ mode: 'impersonate' })).toBe('impersonate');
  });
});

describe('createGoogleAccessTokenProvider', () => {
  it('env mode returns the static token and describes itself', async () => {
    const tokens = createGoogleAccessTokenProvider({
      mode: 'env',
      envToken: 'ya29.from-env',
    });
    expect(tokens.describeCredentials()).toEqual({ mode: 'env' });
    expect(await tokens.getAccessToken()).toBe('ya29.from-env');
  });

  it('env mode rejects a missing token at construction', () => {
    expect(() => createGoogleAccessTokenProvider({ mode: 'env' })).toThrow(/GOOGLE_ACCESS_TOKEN/);
  });

  it('adc mode uses the injected source client', async () => {
    const getAccessToken = vi.fn().mockResolvedValue({ token: 'ya29.adc' });
    const tokens = createGoogleAccessTokenProvider({
      mode: 'adc',
      getSourceClient: () => Promise.resolve({ getAccessToken } as unknown as AuthClient),
    });
    expect(tokens.describeCredentials()).toEqual({ mode: 'adc' });
    expect(await tokens.getAccessToken()).toBe('ya29.adc');
    expect(await tokens.getAccessToken()).toBe('ya29.adc');
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });

  it('impersonate mode requires a target SA', () => {
    expect(() => createGoogleAccessTokenProvider({ mode: 'impersonate' })).toThrow(
      /GOOGLE_IMPERSONATE_SERVICE_ACCOUNT/,
    );
  });

  it('impersonate mode uses source then impersonated client', async () => {
    const sourceGet = vi.fn();
    const impersonatedGet = vi.fn().mockResolvedValue({ token: 'ya29.impersonated' });
    const createImpersonatedClient = vi.fn(
      (input: { targetPrincipal: string; targetScopes: string[] }) => {
        expect(input.targetPrincipal).toBe('memory@proj.iam.gserviceaccount.com');
        expect(input.targetScopes).toContain('https://www.googleapis.com/auth/cloud-platform');
        return { getAccessToken: impersonatedGet } as unknown as AuthClient;
      },
    );
    const tokens = createGoogleAccessTokenProvider({
      mode: 'impersonate',
      impersonateServiceAccount: 'memory@proj.iam.gserviceaccount.com',
      getSourceClient: () =>
        Promise.resolve({ getAccessToken: sourceGet } as unknown as AuthClient),
      createImpersonatedClient,
    });
    expect(tokens.describeCredentials()).toEqual({
      mode: 'impersonate',
      targetPrincipal: 'memory@proj.iam.gserviceaccount.com',
    });
    expect(await tokens.getAccessToken()).toBe('ya29.impersonated');
    expect(createImpersonatedClient).toHaveBeenCalledTimes(1);
    expect(sourceGet).not.toHaveBeenCalled();
  });
});

describe('createAccessTokenProvider', () => {
  it('returns a static env token for envToken input', async () => {
    const tokens = createAccessTokenProvider({ envToken: 'ya29.from-env' });
    expect(await tokens.getAccessToken()).toBe('ya29.from-env');
  });

  it('delegates to adc when envToken is omitted', async () => {
    const getAccessToken = vi.fn().mockResolvedValue({ token: 'ya29.adc-legacy' });
    const tokens = createGoogleAccessTokenProvider({
      mode: 'adc',
      getSourceClient: () => Promise.resolve({ getAccessToken } as unknown as AuthClient),
    });
    expect(await tokens.getAccessToken()).toBe('ya29.adc-legacy');
  });
});
