# ADR-0002 — Server identity comes from configured origin, never from request headers

- **Date:** 2026-07-09 (retroactive; decision inherited from the parent codebase, `data-ingest` commit `20ff561`, 2026-04-24)
- **Status:** Accepted

## Context

The server is its own OAuth 2.1 authorization server, and strict OAuth/MCP
clients (Claude Desktop, Claude.ai, Cursor) verify that the discovery
document's `issuer`, the JWT `iss` claim, and the MCP protected-resource
metadata all agree on one HTTPS origin. Dev and prod both sit behind
TLS-terminating proxies (Tailscale Serve locally, the hosting platform in
prod), so the origin the backend sees on the wire (`http://localhost`) is
wrong as a public identity. This drift broke strict-client OAuth discovery
three separate times in the parent codebase.

## Decision

Every identity-sensitive URL is derived from configuration, never inferred
from the incoming request:

- better-auth requests are rebuilt as `new URL(request.url, config.apiOrigin)`
  (`apps/server/src/index.ts`), so redirects, issuer, and cookies flow from
  the configured public origin.
- OAuth discovery documents are re-served at the root
  (`apps/server/src/routes/well-known.ts`) without any body rewriting — all
  values must agree *by construction*, not by patching outputs.
- The MCP resource identifier (JWT `aud`, protected-resource `resource`) is
  `MCP_CANONICAL_URL`, explicit in prod.
- `trustProxy: true` is scoped to client-IP recovery for rate limiting and
  logs only — never identity.

## Alternatives rejected (both actually tried in the parent codebase)

- **Derive URLs from the Host header** (`http://${request.hostname}`): behind
  a TLS-terminating proxy the backend's view is simply wrong, and trusting
  Host/`X-Forwarded-*` for identity opens host-header-injection into OAuth
  redirects and issuer values.
- **Rewrite the issuer in discovery response bodies**: hid the HTTP/HTTPS
  drift while the JWT `iss` and other endpoints still carried the backend
  origin — one client works, another silently rejects tokens.

## Consequences

- The API domain is baked into OAuth metadata and issued tokens. Changing it
  after launch invalidates sessions and breaks MCP clients that already
  discovered metadata — pick the domain first.
- Anything that mints or advertises an absolute server URL must use
  `config.apiOrigin` / `config.mcpCanonicalUrl`, never the request.
