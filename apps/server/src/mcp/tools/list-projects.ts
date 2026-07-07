import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AccessibleProject } from '../../projects/service.js';
import { listAccessibleProjectsForUser } from '../../projects/service.js';
import type { McpAuthContext } from '../scopes.js';
import { requireScope } from '../scopes.js';

interface ProjectGroup {
  id: string;
  name: string;
  slug: string;
  projects: AccessibleProject[];
}

function groupProjectsByWorkspace(projects: AccessibleProject[]): ProjectGroup[] {
  const groupsByWorkspaceId = new Map<string, ProjectGroup>();

  for (const project of projects) {
    const existing = groupsByWorkspaceId.get(project.workspace.id);
    if (existing) {
      existing.projects.push(project);
      continue;
    }

    groupsByWorkspaceId.set(project.workspace.id, {
      ...project.workspace,
      projects: [project],
    });
  }

  return [...groupsByWorkspaceId.values()];
}

function summarizeProjects(projects: AccessibleProject[], workspaceSlug?: string): string {
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
    .map((project) => `'${project.name}' (${project.workspace.name}, ${project.role})`)
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

      const projects = await listAccessibleProjectsForUser(authCtx.userId, { workspaceSlug });
      const workspaces = groupProjectsByWorkspace(projects);

      return {
        structuredContent: { projects, workspaces },
        content: [{ type: 'text' as const, text: summarizeProjects(projects, workspaceSlug) }],
      };
    },
  );
}
