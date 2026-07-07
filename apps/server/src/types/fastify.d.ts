import 'fastify';
import type { McpAuthContext } from '../mcp/scopes.js';

declare module 'fastify' {
  interface FastifyRequest {
    mcpAuth?: McpAuthContext;
  }
}
