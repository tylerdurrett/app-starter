# App Starter

A full-stack TypeScript starter template:

- **Monorepo** — Turborepo + pnpm workspaces
- **Web** — Vite + React 19 + TanStack Router (`apps/web`)
- **Server** — Fastify (`apps/server`)
- **Auth** — better-auth email/password with email verification and password reset
- **MCP** — OAuth 2.1 provider + Model Context Protocol server with scoped tools
- **Tenancy** — workspaces and projects
- **Integrations** — pluggable integrations framework (`packages/integrations-core`) with Slack as the reference connector
- **Database** — Drizzle ORM + Postgres, via the bundled docker-compose or any Postgres (e.g., Supabase)
- **UI** — Base UI + shadcn-pattern components in `@repo/ui`, Tailwind CSS v4

## Prerequisites

- Node.js
- pnpm
- Docker (or an external Postgres)

## Setup

```sh
pnpm install
pnpm hello     # configure server + web + database ports
```

## Development

```sh
pnpm go        # start everything (Postgres, migrations, server, web)
pnpm stop      # stop server + web (leaves Postgres running)
```

- Web app: `http://localhost:5200`
- Server: `http://localhost:5100/health`
- Ports are defined in `project.config.json` — `pnpm hello` writes them there.

## Production-like HTTPS Dev over Tailscale

Strict OAuth clients require the authorization-server issuer, token `iss`, and
MCP resource metadata to agree on the same HTTPS API origin. To keep local dev
close to production, serve the frontend and API as separate HTTPS origins through
[Tailscale Serve](https://tailscale.com/kb/1242/tailscale-serve):

- Web: `https://<machine>.<tailnet>.ts.net:5200`
- API/Auth/MCP: `https://<machine>.<tailnet>.ts.net`

1. Enable MagicDNS and HTTPS certificates for the tailnet in Tailscale.
2. Start the app locally with `pnpm go`.
3. Start the HTTPS reverse proxies with `pnpm tailscale:serve`.
4. Set these values in `.env`, replacing the host with this machine's MagicDNS name:

```sh
VITE_SERVER_URL=https://<machine>.<tailnet>.ts.net
CORS_ORIGIN=https://<machine>.<tailnet>.ts.net:5200
BETTER_AUTH_URL=https://<machine>.<tailnet>.ts.net
MCP_CANONICAL_URL=https://<machine>.<tailnet>.ts.net/mcp
VITE_ALLOWED_HOSTS=<machine>.<tailnet>.ts.net
```

Then restart `pnpm go` and open the web app at
`https://<machine>.<tailnet>.ts.net:5200`.

For production, use the same model with real domains, for example
`https://app.example.com` for the static frontend and `https://api.example.com`
for API/Auth/MCP.

## MCP Surface

The MCP server identifies itself as `App Starter` during initialization.
Current tools:

- `list_workspaces` — lists workspaces the authenticated user belongs to
  (requires the `workspaces:read` scope)
- `list_projects` — lists projects the authenticated user can access, optionally
  filtered by workspace slug (requires the `projects:read` scope)

If a valid token is missing a tool scope, `/mcp` returns HTTP 403 with an
`insufficient_scope` challenge.

## Individual Commands

| Command                       | Description                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `pnpm hello`                  | Interactive port setup (`project.config.json` + `.env`)                           |
| `pnpm go`                     | Full dev startup: ensure config → wait for DB → migrate → free ports → run dev    |
| `pnpm stop`                   | Kill server + web dev processes (not the DB container)                            |
| `pnpm dev`                    | Start server + web (assumes Postgres is running and migrated)                     |
| `pnpm build`                  | Build all packages                                                                |
| `pnpm lint`                   | Lint all packages                                                                 |
| `pnpm test`                   | Run tests (assumes Postgres is running)                                           |
| `pnpm db:start`               | Start local Postgres (Docker)                                                     |
| `pnpm db:stop`                | Stop local Postgres (Docker)                                                      |
| `pnpm db:reset`               | Destroy volume + recreate Postgres, then migrate + seed                           |
| `pnpm db:migrate`             | Apply pending Drizzle migrations                                                  |
| `pnpm db:seed`                | Seed the database with test data                                                  |
| `pnpm db:studio`              | Open Drizzle Studio (schema + data browser)                                       |
| `pnpm tailscale:serve`        | Share web and API dev servers inside your tailnet over HTTPS with Tailscale Serve |
| `pnpm tailscale:serve:status` | Show current Tailscale Serve config                                               |
| `pnpm tailscale:serve:reset`  | Clear Tailscale Serve config                                                      |
