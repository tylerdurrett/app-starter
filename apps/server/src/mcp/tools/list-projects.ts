import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthorizedProject } from '../../projects/resolver.js';
import { listAuthorizedProjectsForUser } from '../../projects/resolver.js';
import type { McpAuthContext } from '../scopes.js';
import { requireScope } from '../scopes.js';

interface ProjectGroup {
  id: string;
  name: string;
  slug: string;
  projects: AuthorizedProject[];
}

function groupProjectsByWorkspace(projects: AuthorizedProject[]): ProjectGroup[] {
  const groupsByWorkspaceId = new Map<string, ProjectGroup>();

  for (const project of projects) {
    const existing = groupsByWorkspaceId.get(project.workspaceId);
    if (existing) {
      existing.projects.push(project);
      continue;
    }

    groupsByWorkspaceId.set(project.workspaceId, {
      id: project.workspaceId,
      name: project.workspaceName,
      slug: project.workspaceSlug,
      projects: [project],
    });
  }

  return [...groupsByWorkspaceId.values()];
}

function summarizeProjects(projects: AuthorizedProject[], workspaceSlug?: string): string {
  if (projects.length === 0) {
    return workspaceSlug
      ? `No accessible projects found in workspace '${workspaceSlug}'.`
      : 'No accessible projects found.';
  }

  const grouped = groupProjectsByWorkspace(projects);
  const scopeText = workspaceSlug
    ? ` in '${grouped[0]?.name ?? workspaceSlug}'`
    : ` across ${grouped.length} workspace${grouped.length === 1 ? '' : 's'}`;
  const names = projects
    .map((project) => `'${project.name}' (${project.workspaceName}, ${project.role})`)
    .join(', ');

  return `Found ${projects.length} project${projects.length === 1 ? '' : 's'}${scopeText}: ${names}`;
}

export function registerListProjectsTool(server: McpServer, authCtx: McpAuthContext) {
  server.registerTool(
    'list_projects',
    {
      title: 'List App Starter Projects',
      description:
        'List App Starter projects the authenticated user can access, optionally filtered by workspace slug.',
      inputSchema: {
        workspaceSlug: z
          .string()
          .min(1)
          .optional()
          .describe('Optional App Starter workspace slug to filter projects by.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ workspaceSlug }) => {
      requireScope('projects:read', authCtx);

      const projects = workspaceSlug
        ? await listAuthorizedProjectsForUser(authCtx.userId, { workspaceSlug })
        : await listAuthorizedProjectsForUser(authCtx.userId);
      const workspaces = groupProjectsByWorkspace(projects);

      return {
        structuredContent: { projects, workspaces },
        content: [{ type: 'text' as const, text: summarizeProjects(projects, workspaceSlug) }],
      };
    },
  );
}
