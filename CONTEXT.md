# App Starter

A full-stack TypeScript starter template with auth, two-level tenancy, an
integrations framework, and an MCP connector surface built in. Apps are
stamped out of it, so its defaults are product decisions.

## Language

**Workspace**:
The top tenancy level — the group (team/org) that people join and that owns projects.
_Avoid_: organization, team, account

**Project**:
The second tenancy level — the unit of work inside a workspace where day-to-day activity happens.
_Avoid_: workspace (its former name in the schema — see Flagged ambiguities)

**Membership**:
A user's direct role-bearing attachment to one workspace or one project; workspace and project memberships are separate records.

**Role**:
One of `owner`, `manager`, `member` — the same three-role vocabulary at both tenancy levels, each level with its own permission matrix.

**Workspace override**:
The rule that every workspace membership grants access to every project in that workspace without a project membership record: a workspace `owner` or `manager` acts with a synthetic project `owner` role, while a workspace `member` acts with a read-only synthetic project `member` role. A direct project membership takes precedence.

**Invite**:
A pending, emailed offer of membership at one level; distinct from a membership until accepted.

## Relationships

- A **Workspace** contains many **Projects**; a **Project** belongs to exactly one **Workspace**
- A **Project**'s slug is unique within its **Workspace**, not globally; workspace slugs are globally unique (decided in ADR-0009; code catches up via issue #14)
- A user holds at most one **Membership** per workspace and per project
- Every workspace **Membership** implies the **Workspace override** on all contained projects: `owner`/`manager` receive synthetic project `owner` access, while `member` receives read-only synthetic project `member` access
- Deleting a **Workspace** cascades to its **Projects** and their memberships

## Example dialogue

> **Dev:** "This user joined the **Workspace** — which **Projects** can they see?"
> **Domain expert:** "All of them via the **Workspace override**. A workspace `owner` or `manager` gets synthetic project `owner` access; a workspace `member` gets read-only synthetic project `member` access. Any direct project **Membership** takes precedence."

## Flagged ambiguities

- The schema comment `// Projects (formerly workspaces)` records a rename: today's **Project** was originally called "workspace" before the second tenancy level was added. In conversation and code, "workspace" only ever means the top level.
- Project access failures are non-disclosing: a single-Project lookup reports **not found**, list reads omit inaccessible Projects, and last-active restoration returns no Project when its reference is missing or inaccessible. None report forbidden merely because the Project exists.
