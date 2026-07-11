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
  on every project in the workspace, while a workspace `member` acts with
  a read-only synthetic project `member` role. Neither path creates a
  project membership record, and direct project membership takes
  precedence.
- **Non-disclosing access failure**: a user without access to an existing
  project gets `NOT_FOUND` from single-project resolution. List reads omit
  inaccessible projects, and last-active restoration returns no project when
  its reference is missing or inaccessible. None reveal existence with a
  distinct `FORBIDDEN` response.

## Known debt (deliberately NOT an invariant)

- **The duplicated implementation is debt, not design.** The near-identical
  membership/invite/role/permission/slug/service machinery at both levels
  is a retrofit artifact. Streamlining it into shared machinery is tracked
  as a cleanup issue; do not replicate the duplication when adding a
  feature to one level.
