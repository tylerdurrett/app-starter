import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from '@better-auth/oauth-provider';
import { auth } from '../auth.js';
import { config } from '../config.js';
import { MCP_SCOPES } from '../mcp/scopes.js';

/** Bridge a Web API handler ((Request) => Response) into a Fastify route handler. */
async function forwardToWebHandler(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: (req: Request) => Promise<Response>,
) {
  // Use the configured public issuer origin when proxying into BetterAuth.
  // Rewriting discovery bodies hid HTTP/HTTPS issuer drift; strict OAuth
  // clients need metadata, tokens, and resource metadata to agree naturally.
  const url = new URL(request.url, config.apiOrigin);
  const webRequest = new Request(url.toString(), {
    method: 'GET',
    headers: request.headers as HeadersInit,
  });
  const response = await handler(webRequest);
  reply.code(response.status);
  response.headers.forEach((value, key) => reply.header(key, value));
  reply.send(await response.text());
}

const wellKnownRoutes: FastifyPluginAsync = async (app) => {
  app.get('/.well-known/oauth-protected-resource', async (_request, _reply) => {
    return {
      resource: config.mcpCanonicalUrl,
      authorization_servers: [config.apiOrigin],
      scopes_supported: MCP_SCOPES,
      bearer_methods_supported: ['header'],
    };
  });

  // BetterAuth's oauthProvider plugin doesn't auto-serve these at root when
  // mounted under /api/auth/*, so we expose them manually using the provided helpers.
  const asMetadata = oauthProviderAuthServerMetadata(auth);
  const oidcMetadata = oauthProviderOpenIdConfigMetadata(auth);

  // OAuth Authorization Server metadata (RFC 8414)
  app.get('/.well-known/oauth-authorization-server', (req, reply) =>
    forwardToWebHandler(req, reply, asMetadata),
  );

  // OpenID Connect Discovery 1.0
  app.get('/.well-known/openid-configuration', (req, reply) =>
    forwardToWebHandler(req, reply, oidcMetadata),
  );
};

export default wellKnownRoutes;
