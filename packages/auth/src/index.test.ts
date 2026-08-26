import { describe, expect, it } from 'vitest';

import {
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  createLocalHs256Verifier,
  issueLocalAccessToken,
  protectedResourceMetadataPath,
  protectedResourceMetadataUrl,
} from './index.js';

const SECRET = new TextEncoder().encode('local-dev-secret-at-least-32-bytes!');
const ISSUER = 'http://127.0.0.1:8080';
const AUDIENCE = 'http://127.0.0.1:8080';

describe('local HS256 tokens', () => {
  it('round-trips a bearer token into a principal', async () => {
    const token = await issueLocalAccessToken({
      secret: SECRET,
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: 'alice',
      scopes: ['memory.read', 'memory.write'],
    });
    const verifier = createLocalHs256Verifier({
      secret: SECRET,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const principal = await verifier.verify(`Bearer ${token}`);
    expect(principal.subject).toBe('alice');
    expect(principal.issuer).toBe(ISSUER);
    expect(principal.id.startsWith('usr_')).toBe(true);
    expect(principal.scopes).toEqual(['memory.read', 'memory.write']);
  });

  it('rejects missing and wrong-audience tokens', async () => {
    const verifier = createLocalHs256Verifier({
      secret: SECRET,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    await expect(verifier.verify(undefined)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(verifier.verify('Basic nope')).rejects.toMatchObject({ code: 'unauthenticated' });
    const token = await issueLocalAccessToken({
      secret: SECRET,
      issuer: ISSUER,
      audience: 'http://other',
      subject: 'alice',
      scopes: ['memory.read'],
    });
    await expect(verifier.verify(`Bearer ${token}`)).rejects.toThrow();
  });

  it('accepts any audience in a configured allowlist', async () => {
    const profileAudience = `${AUDIENCE}/memory-reader/v1/mcp`;
    const verifier = createLocalHs256Verifier({
      secret: SECRET,
      issuer: ISSUER,
      audience: [AUDIENCE, profileAudience],
    });
    const token = await issueLocalAccessToken({
      secret: SECRET,
      issuer: ISSUER,
      audience: profileAudience,
      subject: 'alice',
      scopes: ['memory.read'],
    });
    const principal = await verifier.verify(`Bearer ${token}`);
    expect(principal.subject).toBe('alice');
  });
});

describe('metadata documents', () => {
  it('builds RFC 9728 and RFC 8414 documents', () => {
    const resource = `${AUDIENCE}/memory-reader/v1/mcp`;
    const prm = buildProtectedResourceMetadata({
      resource,
      authorizationServers: [ISSUER],
      scopesSupported: ['memory.read', 'memory.profile.read'],
    });
    expect(prm.bearer_methods_supported).toEqual(['header']);
    expect(prm.resource).toBe(resource);
    expect(prm.scopes_supported).toEqual(['memory.read', 'memory.profile.read']);
    const as = buildAuthorizationServerMetadata({
      issuer: ISSUER,
      tokenEndpoint: `${ISSUER}/oauth/token`,
    });
    expect(as.grant_types_supported).toEqual(['client_credentials']);
  });

  it('inserts the well-known path per RFC 9728', () => {
    expect(protectedResourceMetadataPath(`${AUDIENCE}/memory-reader/v1/mcp`)).toBe(
      '/.well-known/oauth-protected-resource/memory-reader/v1/mcp',
    );
    expect(protectedResourceMetadataPath(`${AUDIENCE}/`)).toBe(
      '/.well-known/oauth-protected-resource',
    );
    expect(protectedResourceMetadataPath(`${AUDIENCE}/memory-reader/v1/mcp/?v=1`)).toBe(
      '/.well-known/oauth-protected-resource/memory-reader/v1/mcp/?v=1',
    );
    expect(protectedResourceMetadataUrl(`${AUDIENCE}/memory-steward/v1/mcp`)).toBe(
      `${AUDIENCE}/.well-known/oauth-protected-resource/memory-steward/v1/mcp`,
    );
    expect(protectedResourceMetadataUrl(`${AUDIENCE}/memory-steward/v1/mcp?x=y`)).toBe(
      `${AUDIENCE}/.well-known/oauth-protected-resource/memory-steward/v1/mcp?x=y`,
    );
  });
});
