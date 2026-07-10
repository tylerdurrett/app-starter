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
The rule that a workspace `owner` or `manager` acts with a synthetic project `owner` role on every project in the workspace, without a project membership record.

**Invite**:
A pending, emailed offer of membership at one level; distinct from a membership until accepted.

## Relationships

- A **Workspace** contains many **Projects**; a **Project** belongs to exactly one **Workspace**
- A **Project**'s slug is unique within its **Workspace**, not globally; workspace slugs are globally unique (decided in ADR-0009; code catches up via issue #14)
- A user holds at most one **Membership** per workspace and per project
- A workspace **Membership** with role `owner`/`manager` implies the **Workspace override** on all contained projects
- Deleting a **Workspace** cascades to its **Projects** and their memberships

## Example dialogue

> **Dev:** "This user joined the **Workspace** — which **Projects** can they see?"
> **Domain expert:** "If their workspace **Role** is `owner` or `manager`, all of them via the **Workspace override**. Otherwise only projects where they hold a direct **Membership**."

## Flagged ambiguities

- The schema comment `// Projects (formerly workspaces)` records a rename: today's **Project** was originally called "workspace" before the second tenancy level was added. In conversation and code, "workspace" only ever means the top level.
- Access denial to an existing project is reported as **not found**, never as forbidden — non-members must not learn the project exists.
