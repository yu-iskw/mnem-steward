import type { AccessTokenProvider } from './config.js';

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const REFRESH_SKEW_MS = 60_000;
const METADATA_TIMEOUT_MS = 5_000;

export function createAccessTokenProvider(input: {
  envToken?: string;
  fetch?: typeof fetch;
  now?: () => number;
}): AccessTokenProvider {
  let cached: { token: string; expiresAtMs: number } | undefined;
  const fetchImpl = input.fetch ?? fetch;
  const now = input.now ?? Date.now;

  return {
    async getAccessToken(): Promise<string> {
      const fromEnv = input.envToken?.trim();
      if (fromEnv !== undefined && fromEnv !== '') {
        return fromEnv;
      }
      const at = now();
      if (cached !== undefined && cached.expiresAtMs > at + REFRESH_SKEW_MS) {
        return cached.token;
      }
      const metadata = await fetchImpl(METADATA_TOKEN_URL, {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      });
      if (!metadata.ok) {
        throw new Error(`Metadata token server returned ${String(metadata.status)}`);
      }
      const body: unknown = await metadata.json();
      const token = accessTokenFrom(body);
      const expiresIn = expiresInFrom(body);
      cached = { token, expiresAtMs: at + expiresIn * 1000 };
      return token;
    },
  };
}

function accessTokenFrom(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Metadata token server omitted access_token');
  }
  const token = (body as { access_token?: unknown }).access_token;
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('Metadata token server omitted access_token');
  }
  return token;
}

function expiresInFrom(body: unknown): number {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 3600;
  }
  const expiresIn = (body as { expires_in?: unknown }).expires_in;
  return typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
    ? expiresIn
    : 3600;
}
