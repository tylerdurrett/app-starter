import { z } from 'zod';

/**
 * `me`-family API contract — the single source of truth for the shapes exchanged
 * between the server `me` routes and the web client.
 */

/** Response of `GET /api/me/mcp-connector`: the caller's canonical MCP URL. */
export const mcpConnectorSchema = z.object({
  url: z.string(),
});
export type McpConnector = z.infer<typeof mcpConnectorSchema>;
