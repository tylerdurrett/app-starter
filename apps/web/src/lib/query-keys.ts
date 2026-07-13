// Single source of truth for TanStack Query keys across the web app (ADR-0007).
//
// Every converted page imports its query keys from here so reads and writes
// agree on the exact tuple, and writes can invalidate precisely. Keys follow
// the repo's `['workspace', slug]` array idiom and are scoped by the relevant
// slug/id. List keys (plural root, e.g. `projects`) and detail keys (singular
// root, e.g. `project`) use distinct root tokens so invalidating a list never
// cascades into unrelated detail queries, and vice versa. Sub-resources nest
// under their parent's identity tuple so a parent-scoped invalidation cascades
// to them by prefix.
export const queryKeys = {
  // me / MCP connector — re-keys the existing ['me', 'mcp-connector'] query
  // that serves the account page's MCP connector URL.
  mcpConnector: () => ['me', 'mcp-connector'] as const,

  // --- Workspaces ---
  workspaces: () => ['workspaces'] as const,
  workspace: (slug: string) => ['workspace', slug] as const,
  workspaceMembers: (slug: string) => ['workspace', slug, 'members'] as const,
  workspaceInvites: (slug: string) => ['workspace', slug, 'invites'] as const,

  // --- Projects (scoped by workspaceSlug, then projectSlug) ---
  projects: (workspaceSlug: string) => ['projects', workspaceSlug] as const,
  accessibleProjects: () => ['accessible-projects'] as const,
  project: (workspaceSlug: string, slug: string) => ['project', workspaceSlug, slug] as const,
  projectMembers: (workspaceSlug: string, slug: string) =>
    ['project', workspaceSlug, slug, 'members'] as const,
  projectInvites: (workspaceSlug: string, slug: string) =>
    ['project', workspaceSlug, slug, 'invites'] as const,
  lastActiveProject: () => ['last-active-project'] as const,
  lastActiveProjectValidation: (hint: LastActiveProjectHint) =>
    [
      ...queryKeys.lastActiveProject(),
      'validation',
      hint.workspaceSlug,
      hint.projectSlug,
      hint.projectId,
    ] as const,

  // --- Integrations (scoped by workspaceSlug, then integrationId) ---
  integrations: (slug: string) => ['integrations', slug] as const,
  integration: (slug: string, integrationId: string) =>
    ['integration', slug, integrationId] as const,

  // --- OAuth consent client info (scoped by client_id) ---
  oauthClient: (clientId: string) => ['oauth-client', clientId] as const,
} as const;

export type LastActiveProjectHint = {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string | null;
};

export type QueryKeys = typeof queryKeys;
