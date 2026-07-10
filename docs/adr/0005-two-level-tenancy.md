# ADR-0005 — Two-level tenancy: workspaces contain projects

- **Date:** 2026-07-09 (retroactive for the model's origin in the parent codebase; keeping it is a fresh, affirmed decision)
- **Status:** Accepted

## Context

The schema comment `// Projects (formerly workspaces)` records the history:
the parent codebase started with one tenancy level ("workspaces"), renamed
it to "projects", and grafted a new workspace level on top. The starter
inherits the result. Tenancy is the most product-shaped decision in a
starter template — every app stamped from it inherits the model, and
levels are expensive to add or remove later (schema migrations, URL
structure: `/w/$workspaceSlug` and `/p/$projectSlug`).

## Decision

**Keep two-level tenancy as the starter default**: a Workspace (team/org,
the group people join) contains Projects (the unit of day-to-day work).
See `CONTEXT.md` for the canonical vocabulary. Affirmed 2026-07-09 on the
grounds that the two-level B2B shape is the common target and is hard to
retrofit; single-level apps can ignore or thin the workspace layer far
more cheaply than the reverse.

Two access rules are deliberate invariants:

- **Workspace override** (`apps/server/src/projects/resolver.ts`): a
  workspace `owner`/`manager` acts with a synthetic project `owner` role
  on every project in the workspace, with no membership record. Direct
  project membership takes precedence.
- **404, never 403**: a user without access to an existing project gets
  `NOT_FOUND`. Non-members must not learn the project exists.

## Known debt and gaps (deliberately NOT invariants)

- **The duplicated implementation is debt, not design.** The near-identical
  membership/invite/role/permission/slug/service machinery at both levels
  is a retrofit artifact. Streamlining it into shared machinery is tracked
  as a cleanup issue; do not replicate the duplication when adding a
  feature to one level.
- **Plain workspace `member` visibility is a known gap.** Today a
  workspace `member` with no direct project membership sees zero projects
  (the override only fires for owner/manager). This closed-by-default
  behavior was never chosen; it reads as broken to end users and is
  tracked as a feature-gap issue. Do not cite this ADR to defend it.
