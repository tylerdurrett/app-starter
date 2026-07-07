import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpAuthContext } from './scopes.js';
import { registerListProjectsTool } from './tools/list-projects.js';
import { registerListWorkspacesTool } from './tools/list-workspaces.js';

const SERVER_NAME = 'app-starter';
const SERVER_TITLE = 'App Starter';
const SERVER_VERSION = '0.1.0';
const SERVER_DESCRIPTION =
  'App Starter exposes authenticated workspace and project context to AI agents.';
const SERVER_INSTRUCTIONS =
  'This MCP server is for App Starter, an application that organizes work into workspaces and projects. It is not a Tailscale service and does not manage networks or devices. Treat workspaces as App Starter application workspaces.';

/**
 * Creates a per-request McpServer. Stateless mode requires a fresh instance
 * per request — tools capture authCtx via closure for per-request identity.
 */
export function createMcpServer(authCtx: McpAuthContext) {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: SERVER_TITLE,
      version: SERVER_VERSION,
      description: SERVER_DESCRIPTION,
    },
    {
      capabilities: { tools: {} },
      // Keep this explicit so MCP clients don't infer product meaning from dev
      // transport URLs such as Tailscale Serve hostnames.
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerListWorkspacesTool(server, authCtx);
  registerListProjectsTool(server, authCtx);

  return server;
}
