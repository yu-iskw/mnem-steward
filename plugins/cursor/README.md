# Cursor plugin notes

Configure a remote MCP server for this repository:

- URL: `{PUBLIC_BASE_URL}/mcp`
- Auth: OAuth 2.1 resource server (RFC 9728 metadata at `/.well-known/oauth-protected-resource/mcp`)

Local development:

```bash
export PUBLIC_BASE_URL=http://127.0.0.1:8080
export AUTH_MODE=local
export MEMORY_STORE=in-memory
export LOCAL_JWT_SECRET=local-dev-secret-at-least-32-bytes!
pnpm --filter @mnem-steward/gateway build
pnpm --filter @mnem-steward/gateway start
```

Issue a token:

```bash
curl -s http://127.0.0.1:8080/oauth/token \
  -H 'content-type: application/json' \
  -d '{"grant_type":"client_credentials","sub":"dev","scope":"memory.read memory.write memory.delete memory.profile.read memory.history.read"}'
```
