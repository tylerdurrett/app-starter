# ADR-0010 — Internal packages: TypeScript source in dev, compiled dist in prod

- **Date:** 2026-07-09 (retroactive; pattern finalized in the parent codebase's deployment-readiness pass, 2026-04-29)
- **Status:** Accepted

## Context

Internal packages (`@repo/db`, `@repo/shared`, `@repo/integrations-core`)
are consumed by the server in two modes: during development the server
should hot-reload instantly when package source changes (no rebuild
pipeline), but production must run plain `node dist/main.js` against
compiled JS.

## Decision

Dual-mode resolution via a custom export condition. Each package exports
`"development": "./src/index.ts"` alongside `"default": "./dist/src/index.js"`;
the server's `dev` and `test` scripts run under
`NODE_OPTIONS='--conditions=development'` with `tsx watch --include`
globs covering the package sources. Prod resolves `default` and runs
compiled output.

Provenance: the src-in-dev DX was deliberate from day one in the parent
codebase (the tsx-watch package-source globs are specified in its
foundation plan). The conditions/dist half was a considered fix during
production smoke-testing — originally packages exported *only* TS source
and built only declarations, so `node dist/main.js` could not work at
all. The chosen fix preserved the dev DX exactly while making prod
resolution real. No stale-dist or resolution bugs since.

## Operational rules

- **Every new Node entrypoint that should run against live package source
  (script, test runner, debugger config) must set
  `NODE_OPTIONS='--conditions=development'`.** Without it, resolution
  silently falls back to `dist/` and runs stale compiled code — no error,
  just old behavior.
- **Keep a production-mode smoke test** (`pnpm build && node
  apps/server/dist/main.js` + health check). Dev-mode success proves
  nothing about `default`-condition resolution; the one burn in this
  pattern's history was exactly that gap.
