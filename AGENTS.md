Any instructions in this file must be VERY concise since this loads in every agent session. Add a short instruction and link out to a more detailed doc.

## Agent skills

This repo uses the tdog engineering skill set; its conventions live under [docs/agents/](docs/agents/) — read [docs/agents/README.md](docs/agents/README.md) first. Specs are GitHub issues on `tylerdurrett/app-starter`.

## Development

- Dev ports are NOT the defaults (3000/8080/etc) — read `project.config.json` for `serverPort`/`webPort`/`dbPort` before curling or opening URLs. Check if a dev server is already running on the configured port before starting one.
- **Never run `drizzle-kit push`.** Schema changes go through `pnpm db:generate` (creates a migration file, commit it) → `pnpm db:migrate`. When iterating on schema, use `pnpm db:reset`. `push` mutates the DB without recording a migration, causing drift.
- Always write tests, but mocked tests are not enough — after building a feature, smoke-test the real endpoint/UI end-to-end. If something fails during your work, investigate it — don't work around it.
- Keep code minimal and pragmatic: exactly the functionality we need, nothing more. Flag security issues whenever you see them.