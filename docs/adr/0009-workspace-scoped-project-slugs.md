# ADR-0009 — Project slugs are workspace-scoped; project URLs include the workspace

- **Date:** 2026-07-09
- **Status:** Accepted (implementation pending — the code contradicts this ADR until the tracked issue lands)

## Context

Inherited behavior: project slugs are globally unique across all
workspaces (`projects.slug` has a table-wide unique constraint), which is
what allows the flat `/p/$projectSlug` URL with no workspace segment. This
was rename inertia, not a choice — projects were "workspaces" when they
were the only tenancy level, and kept the global-uniqueness property when
the second level was added (see ADR-0005).

## Decision

**Scope project slug uniqueness to the workspace, and include the
workspace in project URLs** (`/w/$workspaceSlug/p/$projectSlug` shape).
Two workspaces can each have a project named "marketing" without suffix
mangling; the URL carries its tenancy context.

Rejected: keeping flat URLs. Pleasant to read, but global uniqueness makes
one tenant's naming degrade another's (`marketing-2`), leaks name
collisions across tenant boundaries, and reads as a bug in a B2B product.

## Consequences

- Schema migration: `projects.slug` unique → composite unique on
  `(workspace_id, slug)`.
- Slug generation dedupes within the workspace only.
- Server routes/resolvers identify a project by (workspace, slug) instead
  of slug alone; web routes, links, and the localStorage active-context
  slugs follow.
- URLs change shape — acceptable now (pre-launch starter), the reason to
  do it immediately rather than after apps are stamped from the template.
