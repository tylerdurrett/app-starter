# ADR-0012 — Signup provisioning is best-effort; the onboarding fallback is the guarantee

- **Date:** 2026-07-09 (retroactive; designed as a pair in the parent codebase's workspaces spec, 2026-04-16)
- **Status:** Accepted

## Context

Every user needs at least one workspace and project. Provisioning them in
the signup lifecycle avoids an onboarding step in the common case — but
user creation happens inside better-auth's flow, so provisioning in a
`user.create.after` hook cannot share a transaction with the user insert.

## Decision

Two deliberately paired pieces (specified together, built the same day in
the parent codebase — this is a designed pair, not a happy accident):

- **The hook is best-effort** (`apps/server/src/hooks/post-signup.ts`):
  it creates a personal workspace and default project, logs failures
  loudly, and never throws — the user record is already committed, and
  signup must not fail because a tenancy insert hiccuped. There was never
  a transactional or signup-blocking variant; the spec ruled that out
  before code existed ("atomicity is not required, but silent partial
  success is not acceptable").
- **The resolver fallback chain is the actual guarantee**
  (`apps/web/src/lib/project-resolver.ts`): last-active project → first
  project → first workspace → `/onboarding/create-workspace`. Any
  partial-provisioning state self-heals through the UI; the onboarding
  page is the spec'd zero-workspace path, covering hook failures and any
  user that predates the hook.

## The invariant

**No feature may assume a user has a workspace or project.** The hook is
an optimization for the common case; the resolver chain is the contract.
Two "fixes" this ADR exists to prevent: making signup fail when
provisioning fails (worse UX, couples signup to tenancy), and building
features that assume `workspaces.length > 0` because "signup creates one"
(best-effort means sometimes it doesn't).

## Notes in passing

Two small improvements for whoever next touches the hook; not worth issues:

- Full atomicity with the user insert is impossible from the hook (the
  user row is already committed by better-auth's adapter when
  `user.create.after` runs), but the workspace + project pair *can* share
  one `db.transaction`, eliminating the workspace-without-project partial
  state. The invariant above is unchanged either way.
- The hook logs via `console.error`, bypassing the server's structured
  pino logging/redaction.
