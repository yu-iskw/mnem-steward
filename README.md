# Mnem Steward

Company-owned control plane for personal agent memory. Clients talk MCP and REST to this gateway; Google Memory Bank is a pluggable backend, not the public API.

See [RFC 0001](docs/rfc/0001-enterprise-agent-memory-platform.md) for the implementation contract.

## Getting Started

### Prerequisites

- [pnpm](https://pnpm.io/) **11.x** (see `packageManager` in `package.json`; use [Corepack](https://nodejs.org/api/corepack.html): `corepack enable`)
- Node.js **22+** (see `engines` in `package.json`; `.node-version` pins the version used for local dev and CI)

Dependency installs follow pnpm 11 supply-chain settings in [`pnpm-workspace.yaml`](pnpm-workspace.yaml): **minimum release age** (this repository uses a **7-day** quarantine, stricter than pnpm’s built-in 24-hour default), **blocking exotic transitive dependencies**, and an **`allowBuilds`** allowlist for packages that run install scripts.

Linting and formatting use [Trunk](https://trunk.io/) (ESLint, Prettier, and more). The Trunk **launcher** is installed with project dependencies—you do not need a separate Trunk install for the default workflow.

### Installation

```bash
pnpm install
```

Optional: prefetch Trunk’s hermetic tools (helpful for offline work or CI images):

```bash
pnpm exec trunk install
```

### Local gateway

```bash
cp .env.example .env
pnpm build
set -a && source .env && set +a
pnpm start
```

Issue a local access token:

```bash
curl -s http://127.0.0.1:8080/oauth/token \
  -H 'content-type: application/json' \
  -d '{"grant_type":"client_credentials","sub":"dev","scope":"memory.read memory.write memory.delete memory.profile.read memory.history.read"}'
```

MCP endpoint: `POST /mcp`. REST search: `POST /v1/memories:search`.

### Local STDIO MCP (individual IDE clients)

Same tools and `MemoryService` as HTTP. Auth is a bearer JWT in `MNEM_ACCESS_TOKEN` (mint via `POST /oauth/token` above, or a JWKS-issued token).

```bash
export MNEM_ACCESS_TOKEN='<access_token>'
pnpm --filter @mnem-steward/gateway mcp:stdio
```

Cursor `mcp.json` example (paths relative to your checkout):

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

Build the gateway first (`pnpm --filter @mnem-steward/gateway build`). `MEMORY_STORE=in-memory` is process-local; `google` shares the production Memory Bank with the HTTP gateway. Audit lines go to stderr so they do not corrupt the STDIO wire.

### Build

```bash
pnpm build
```

### Test

```bash
pnpm test
```

### Linting & Formatting

```bash
pnpm lint
pnpm format
```

## Project Structure

- `packages/core`: Domain model, policy, secret scanning, in-memory store, `MemoryService`
- `packages/auth`: OAuth 2.1 resource-server JWT helpers and RFC 9728 metadata
- `packages/google-memory`: Google Memory Bank v1beta1 adapter
- `packages/gateway`: Cloud Run Hono process (REST + MCP HTTP/STDIO)
- `packages/sdk`: TypeScript REST client
- `docs/rfc`: Accepted RFC
- `infra/terraform`: Cloud Run skeleton
- `plugins`: Claude Code and Cursor integration notes

## License

Apache-2.0
