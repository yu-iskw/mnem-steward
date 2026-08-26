# Cursor plugin notes

## Remote MCP (Streamable HTTP)

Configure a remote MCP server for this repository. Prefer the **reader** profile for coding agents:

- URL: `{PUBLIC_BASE_URL}/memory-reader/v1/mcp`
- Auth: OAuth 2.1 resource server (RFC 9728 metadata at `/.well-known/oauth-protected-resource/memory-reader/v1/mcp`)

Other profiles:

| Job              | URL                         | Tools                         |
| ---------------- | --------------------------- | ----------------------------- |
| Recall only      | `/memory-reader/v1/mcp`     | search, profile get           |
| Persist facts    | `/memory-steward/v1/mcp`    | search, profile get, remember |
| Forget / history | `/memory-governance/v1/mcp` | forget, history               |

Local development (HTTP gateway):

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

## Local STDIO MCP (individual users)

Same tools and store wiring as the HTTP gateway. Put a bearer JWT in `MNEM_ACCESS_TOKEN`.

```json
{
  "mcpServers": {
    "mnem-steward": {
      "command": "node",
      "args": ["packages/gateway/dist/stdio-main.js"],
      "env": {
        "PUBLIC_BASE_URL": "http://127.0.0.1:8080",
        "AUTH_MODE": "local",
        "MEMORY_STORE": "in-memory",
        "LOCAL_JWT_SECRET": "local-dev-secret-at-least-32-bytes!",
        "MNEM_ACCESS_TOKEN": "<access_token>"
      }
    }
  }
}
```

Or: `pnpm --filter @mnem-steward/gateway mcp:stdio` with the same env. Audit logs go to stderr. `in-memory` is process-local; `MEMORY_STORE=google` shares the enterprise backend with remote HTTP clients.
