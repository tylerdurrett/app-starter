# ADR-0004 — We are our own OAuth 2.1 authorization server

- **Date:** 2026-07-09 (retroactive; decision inherited from the parent codebase's MCP build-out, 2026-04-20)
- **Status:** Accepted

## Context

Exposing the app as a remote MCP connector (Claude Desktop, Claude.ai,
Cursor) requires an OAuth 2.1 authorization server that MCP clients can
discover and get tokens from. Primary auth (email/password, sessions) was
already self-hosted with better-auth.

## Decision

The API server is both the OAuth 2.1 authorization server and the resource
server, via better-auth's `oauthProvider` plugin
(`apps/server/src/auth.ts`). Better-auth's built-in `/token` path is
disabled so the provider owns the token endpoint; login/consent pages are
full URLs on the web origin; token TTLs are 1h access / 30d refresh.

This was **downstream of already owning auth**, not a fresh vendor
evaluation: an external IdP (Auth0/Clerk/WorkOS) would have needed to know
our users, meaning either migrating primary auth to the vendor or
federating better-auth into it — both far larger than the MCP feature
warranted. Given better-auth, self-hosting the AS was the only coherent
option; no external IdP was seriously evaluated, and this ADR should not
be read as a considered rejection of one.

## Trade-off accepted

We own a security-critical, spec-tracking surface: token endpoint
hardening, PKCE, consent, redirect-URI validation, signing-key management,
and keeping pace with the (still-moving) MCP auth spec. Mitigations in
place: stricter rate limiting on `/api/auth/oauth2/token`, production
config fail-fast, log redaction, and the provider being maintained plugin
code rather than hand-rolled crypto. Known youth symptoms of the plugin:
`verifyAccessToken` didn't exist when needed (we verify with `jose`
directly, see ADR-0003), and the `jwkss` table-name alias in auth.ts.

## Known gap (deliberate hardening, unfinished consequence)

`allowDynamicClientRegistration: false` — DCR was enabled during
development for MCP clients, then disabled pre-launch as an unauthenticated
DB-write surface. That was right, but no replacement registration path
(seed script, admin command, or Client ID Metadata Document support) was
ever built, and the connector flow was never smoke-tested against a real
Claude client with DCR off. Until that lands (tracked as a cleanup issue),
a fresh deployment's "paste the connector URL into Claude" flow likely
cannot complete because clients have no way to obtain a `client_id`. Do
not treat client registration as solved.
