# ADR-0003 — MCP endpoint: stateless per-request servers, locally-verified JWTs, HTTP-layer scope challenges

- **Date:** 2026-07-09 (retroactive; decisions inherited from the parent codebase's MCP build-out, 2026-04-20 → 2026-04-24)
- **Status:** Accepted

## Context

The server exposes an MCP Streamable HTTP endpoint (`/mcp`) that remote
clients (Claude Desktop, Claude.ai, Cursor) connect to with OAuth bearer
tokens. Three interlocking decisions shape it; all were made deliberately
at design time in the parent codebase and refined through real-client
testing.

## Decisions

### 1. Stateless, per-request MCP server

Every POST creates a fresh `McpServer` + `StreamableHTTPServerTransport`
with `sessionIdGenerator: undefined`; GET returns 405
(`apps/server/src/mcp/plugin.ts`). Rationale: the tools are all reads, so
there is no session state worth keeping; stateless works with horizontal
scaling (no sticky sessions) and simplifies audit logging. The per-request
server is also the **auth-context carrier** — `createMcpServer(authCtx)`
lets tools capture `{userId, scopes}` via closure, with no
AsyncLocalStorage.

Traded away: server-initiated notifications, SSE streaming, resumability.
Revisit only if a tool becomes long-running. The lifecycle code in
plugin.ts (close-listener registered *before* `handleRequest`, catch-block
double-close, `reply.hijack()`, passing Fastify's pre-parsed body to the
SDK) encodes real integration gotchas — keep it intact.

### 2. Bearer tokens verified locally against our own JWKS

`verifyMcpRequest` (`apps/server/src/mcp/auth.ts`) verifies the JWT with
`jose` against `${apiOrigin}/api/auth/jwks`, checking `iss = apiOrigin` and
`aud = mcpCanonicalUrl` — no DB hit or introspection RPC per request.

**Delayed revocation was consciously accepted, not overlooked**: a revoked
token stays valid until expiry. The exposure is bounded by a 1-hour access
token TTL + 30-day refresh rotation — refresh grants go through the
DB-backed token endpoint, so revocation bites at the next refresh (worst
case ~60 minutes). If a "revoke this client *now*" feature is ever needed,
it requires introspection or a denylist for that window.

(`jose` is used directly because better-auth's documented
`verifyAccessToken` helper did not exist in the installed package —
implementation accident, not preference.)

### 3. Per-tool scope challenges at the HTTP layer, before the SDK

`rejectInsufficientMcpToolScope` pre-parses the JSON-RPC body for
`tools/call`, maps tool name → scope via `MCP_TOOL_SCOPES`, and on a
missing scope replies **HTTP 403 with an RFC 6750
`WWW-Authenticate: Bearer error="insufficient_scope"` challenge** naming
the union of granted + required scopes.

This is **step-up UX, not redundant enforcement**. Inside the SDK a scope
failure can only surface as a JSON-RPC tool error, which clients read as
"tool failed"; the HTTP challenge is what tells a strict client to
re-authorize for more scopes. The challenge deliberately preserves
already-granted scopes (so step-up doesn't trade one permission for
another) and mirrors the error into the JSON-RPC body (some clients
surface bodies more reliably than headers) — both learned from real-client
testing.

The in-tool `requireScope()` calls are the enforcement backstop:
`MCP_TOOL_SCOPES` is an allowlist, so a tool missing from it sails through
the HTTP layer.

## Operational rules

- **New tool ⇒ add it to `MCP_TOOL_SCOPES` *and* call `requireScope()` in
  the handler.** The HTTP layer is UX; the in-tool check is enforcement.
- **Do not "simplify away" the JSON-RPC pre-parse.** Removing it keeps
  enforcement (backstop holds) but silently breaks step-up auth in strict
  clients — no tool-logic test will catch it.
