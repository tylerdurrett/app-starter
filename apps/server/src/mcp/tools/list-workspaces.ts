import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpAuthContext } from '../scopes.js';
import { requireScope } from '../scopes.js';
import { listWorkspacesForUser } from '../../workspaces/service.js';

export function registerListWorkspacesTool(server: McpServer, authCtx: McpAuthContext) {
  server.registerTool(
    'list_workspaces',
    {
      title: 'List App Starter Workspaces',
      description:
        'List App Starter application workspaces the authenticated user belongs to. These are not Tailscale workspaces or network devices.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      requireScope('workspaces:read', authCtx);

      const workspaces = await listWorkspacesForUser(authCtx.userId);

      const text =
        workspaces.length === 0
          ? 'No workspaces found.'
          : `Found ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}: ${workspaces.map((w) => `'${w.name}' (${w.role})`).join(', ')}`;

      return {
        structuredContent: { workspaces },
        content: [{ type: 'text' as const, text }],
      };
    },
  );
}
