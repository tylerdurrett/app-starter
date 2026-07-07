import type { FastifyPluginAsync } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { rejectInsufficientMcpToolScope, verifyMcpRequest } from './auth.js';
import { createMcpServer } from './index.js';

/**
 * Fastify plugin: MCP Streamable HTTP endpoint at /mcp.
 *
 * - POST /mcp: bearer-auth gated, per-request McpServer + stateless transport
 * - GET  /mcp: 405 (stateless mode — no session to stream notifications to)
 */
const mcpPlugin: FastifyPluginAsync = async (app) => {
  app.post('/mcp', { preHandler: [verifyMcpRequest] }, async (request, reply) => {
    const authCtx = request.mcpAuth!;
    if (rejectInsufficientMcpToolScope(request, reply)) return;

    const server = createMcpServer(authCtx);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    try {
      await server.connect(transport);
      reply.hijack();

      // Register cleanup before handleRequest so we never miss the close event
      reply.raw.on('close', () => {
        server.close();
      });

      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      // Ensure cleanup on error — the 'close' listener may not have fired
      await transport.close().catch(() => {});
      await server.close().catch(() => {});

      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }),
        );
      }
      request.log.error(error, 'MCP request handler error');
    }
  });

  app.get('/mcp', async (_request, reply) => {
    reply.code(405).send({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });
};

export default mcpPlugin;
