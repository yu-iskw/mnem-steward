# ADR 0001: Enterprise memory control plane

## Status

Accepted

## Context

Agents need durable personal context, but Google Memory Bank is a managed store rather than an enterprise policy, identity, or protocol boundary.

## Decision

Own an Enterprise Memory Control Plane in this repository. Expose MCP (Streamable HTTP and STDIO) and REST. Persist through a `MemoryStore` port. Use an in-memory store for local/test and Google Memory Bank v1beta1 for production.

Personal memory is the default namespace. Shared namespaces are typed but denied until an explicit promotion workflow exists.

## Consequences

- Protocol and policy can evolve without rewriting every agent.
- Production still depends on Memory Bank availability and regional constraints.
- Milestone 1 does not ship shared memory, admin UI, or edge security modules.
