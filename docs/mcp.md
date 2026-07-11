# MCP surface

The MCP server identifies itself as `App Starter` during initialization and
exposes scoped tools over `/mcp`. Access is gated by a self-hosted OAuth 2.1
provider (see [ADR-0004](adr/0004-self-hosted-oauth-authorization-server.md) and
[ADR-0003](adr/0003-mcp-stateless-jwt-http-scope-challenges.md)).

## Tools

| Tool              | Scope               | Description                                                              |
| ----------------- | ------------------- | ----------------------------------------------------------------------- |
| `list_workspaces` | `workspaces:read`   | Lists workspaces the authenticated user belongs to                      |
| `list_projects`   | `projects:read`     | Lists accessible projects, optionally filtered by workspace slug        |

If a valid token is missing a tool's scope, `/mcp` returns HTTP 403 with an
`insufficient_scope` challenge.
