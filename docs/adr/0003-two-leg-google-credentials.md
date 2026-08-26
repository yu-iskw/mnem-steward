# ADR 0003: Two-leg Google credentials for Memory Bank

## Status

Accepted

## Context

[ADR 0002](0002-mcp-capability-profiles-and-tool-annotations.md) keeps MCP OAuth/JWT as the resource-server identity and states that Google Memory Bank uses a separate credential. The first Google token helper only supported `GOOGLE_ACCESS_TOKEN` or the GCE metadata server. Local STDIO and Cloud Run need Application Default Credentials (ADC), and production often needs the gateway runtime SA to impersonate a narrower Memory Bank executor SA via the IAM Credentials API.

MCP security guidance forbids token passthrough: a bearer issued for the MCP resource must not be forwarded unmodified to a downstream API.

## Decision

1. Keep the **MCP leg** unchanged: HTTP and STDIO require a JWT with `aud` in `{ AUTH_AUDIENCE, …mounted profile resources }`. Scopes and capability profiles still gate tools.
2. Implement a **Google leg** broker (`createGoogleAccessTokenProvider`) with modes:
   - `env` — static `GOOGLE_ACCESS_TOKEN` (tests/CI/local print-access-token)
   - `adc` — `google-auth-library` Application Default Credentials (user ADC, Cloud Run SA, or ADC already configured with gcloud impersonation)
   - `impersonate` — ADC/source identity + `Impersonated` client for allowlisted `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT`
3. Default when `MEMORY_STORE=google`: `env` if `GOOGLE_ACCESS_TOKEN` is set, otherwise `adc`. Explicit `GOOGLE_CREDENTIAL_MODE` overrides.
4. Target SA is config-only. Agents cannot choose the impersonation target. The MCP bearer is never used as the Memory Bank `Authorization` header.
5. Defer user-Google OAuth / URL elicitation / Token Exchange as the impersonation _source_. “Impersonate by user token” means: user JWT authorizes the MCP call; the gateway SA then impersonates the target SA.

## Consequences

- STDIO local Google access can use ADC or impersonation without printing tokens into env when preferred.
- Cloud Run can use runtime SA ADC, or impersonate a dedicated Memory Bank SA (Token Creator on the target).
- Operators must enable IAM Credentials API and grant `roles/iam.serviceAccountTokenCreator` for impersonate mode.
- Personal memory `principal_id` remains the MCP `iss`+`sub`, not the Google SA.
