import { describe, expect, it } from 'vitest';

import { createAccessTokenProvider } from './access-token.js';

describe('createAccessTokenProvider', () => {
  it('returns a static env token without calling metadata', async () => {
    const tokens = createAccessTokenProvider({
      envToken: 'ya29.from-env',
      fetch() {
        throw new Error('metadata should not be called');
      },
    });
    expect(await tokens.getAccessToken()).toBe('ya29.from-env');
  });

  it('caches metadata tokens until near expiry', async () => {
    let calls = 0;
    let now = 1_000_000;
    const tokens = createAccessTokenProvider({
      now: () => now,
      fetch() {
        calls += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: `tok-${String(calls)}`, expires_in: 3600 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      },
    });
    expect(await tokens.getAccessToken()).toBe('tok-1');
    expect(await tokens.getAccessToken()).toBe('tok-1');
    expect(calls).toBe(1);
    now += 3_600_000;
    expect(await tokens.getAccessToken()).toBe('tok-2');
    expect(calls).toBe(2);
  });
});
