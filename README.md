# App Starter

A full-stack TypeScript starter for multi-tenant apps — auth, two-level tenancy,
a pluggable integrations framework, and an MCP connector surface, all wired up.

## Getting started

Prerequisites: Node.js, pnpm, and Docker (or an external Postgres).

```sh
pnpm install
pnpm hello     # pick server/web/db ports → writes project.config.json + .env
pnpm go        # start Postgres, run migrations, launch server + web
```

- Web: http://localhost:5200
- Server health: http://localhost:5100/health
- `pnpm stop` stops server + web; Postgres keeps running.

Ports live in `project.config.json` (defaults may differ — `pnpm hello` sets them).

## What's inside

- **Monorepo** — Turborepo + pnpm workspaces (`apps/*`, `packages/*`)
- **Web** — Vite + React 19, TanStack Router + Query, Tailwind v4, Base UI components (`@repo/ui`)
- **Server** — Fastify + Drizzle ORM + Postgres
- **Auth** — better-auth email/password with verification and password reset
- **Tenancy** — workspaces → projects with role-based membership
- **MCP** — self-hosted OAuth 2.1 provider + Model Context Protocol server with scoped tools
- **Integrations** — pluggable framework (`packages/integrations-core`), Slack as the reference connector

## Commands

`pnpm go` covers the common path. Also: `pnpm dev`, `pnpm build`, `pnpm lint`,
`pnpm test`, and the `pnpm db:*` family (`db:reset`, `db:migrate`, `db:seed`,
`db:studio`). Run `pnpm run` to list everything.

> Never run `drizzle-kit push` — schema changes go through `pnpm db:generate`
> (commit the migration) then `pnpm db:migrate`.

## Docs

- [CONTEXT.md](CONTEXT.md) — domain language and the tenancy model
- [docs/adr/](docs/adr/) — architecture decision records
- [MCP surface](docs/mcp.md) — the connector's tools and scopes
- [HTTPS dev over Tailscale](docs/dev-https-tailscale.md) — production-like local OAuth
- [Agent workflow](docs/agents/README.md) — how specs flow from idea to ship
