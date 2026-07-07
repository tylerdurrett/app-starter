import type { FastifyRequest, FastifyReply } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';
import { MCP_SCOPES, MCP_SCOPE_STRING, MCP_TOOL_SCOPES } from './scopes.js';
import type { McpAuthContext } from './scopes.js';

const jwks = createRemoteJWKSet(new URL(`${config.apiOrigin}/api/auth/jwks`));

// Constant — config values are set once at startup
const WWW_AUTHENTICATE = `Bearer resource_metadata="${config.apiOrigin}/.well-known/oauth-protected-resource", scope="${MCP_SCOPE_STRING}"`;
const MCP_RESOURCE_METADATA = `${config.apiOrigin}/.well-known/oauth-protected-resource`;

type JsonRpcId = string | number | null;

interface ToolCallScopeRequest {
  id: JsonRpcId;
  requiredScope: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function jsonRpcId(value: unknown): JsonRpcId {
  return typeof value === 'string' || typeof value === 'number' || value === null ? value : null;
}

export function getRequiredScopeForMcpBody(body: unknown): ToolCallScopeRequest | null {
  return getToolScopeRequests(body)[0] ?? null;
}

function getMissingScopeForMcpBody(
  body: unknown,
  authCtx: McpAuthContext,
): ToolCallScopeRequest | null {
  return getToolScopeRequests(body).find(
    (toolScope) => !authCtx.scopes.includes(toolScope.requiredScope),
  ) ?? null;
}

function getToolScopeRequests(body: unknown): ToolCallScopeRequest[] {
  const messages = Array.isArray(body) ? body : [body];
  const toolScopes: ToolCallScopeRequest[] = [];
  for (const message of messages) {
    if (!isRecord(message) || message.method !== 'tools/call' || !isRecord(message.params)) {
      continue;
    }

    const toolName = message.params.name;
    if (typeof toolName !== 'string') continue;

    const requiredScope = MCP_TOOL_SCOPES[toolName];
    if (requiredScope) {
      toolScopes.push({
        id: jsonRpcId(message.id),
        requiredScope,
      });
    }
  }

  return toolScopes;
}

export function buildInsufficientScopeHeader(
  requiredScope: string,
  authCtx: McpAuthContext,
): string {
  const scopeString = insufficientScopeString(requiredScope, authCtx);

  return `Bearer error="insufficient_scope", resource_metadata="${MCP_RESOURCE_METADATA}", scope="${scopeString}", error_description="Missing required scope: ${requiredScope}"`;
}

function insufficientScopeString(requiredScope: string, authCtx: McpAuthContext): string {
  // Preserve already-granted MCP scopes in the challenge so step-up auth does
  // not accidentally trade one tool permission for another.
  const requestedScopes = MCP_SCOPES.filter(
    (scope) => scope === requiredScope || authCtx.scopes.includes(scope),
  );

  return requestedScopes.length > 0 ? requestedScopes.join(' ') : requiredScope;
}

/**
 * Fastify preHandler that validates:
 * 1. Origin header (when present) against allowed origins
 * 2. Bearer token from Authorization header
 * 3. JWT signature, exp, iss, and aud claims
 *
 * On success, attaches { userId, scopes } to request.mcpAuth.
 */
export async function verifyMcpRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Origin check first — MCP clients (Claude Desktop, Cursor) don't send Origin; only browsers do
  const origin = request.headers.origin;
  if (origin && origin !== config.webOrigin) {
    reply.code(403).send({ error: 'Forbidden: invalid origin' });
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).header('www-authenticate', WWW_AUTHENTICATE).send({ error: 'Unauthorized' });
    return;
  }
  const token = authHeader.slice(7);

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.apiOrigin,
      audience: config.mcpCanonicalUrl,
    });

    const scopeStr = (payload.scope as string) || '';
    request.mcpAuth = {
      userId: payload.sub!,
      scopes: scopeStr ? scopeStr.split(' ') : [],
    };
  } catch {
    // Any verification failure (expired, wrong aud/iss, bad signature) → 401
    reply.code(401).header('www-authenticate', WWW_AUTHENTICATE).send({ error: 'Unauthorized' });
    return;
  }
}

export function rejectInsufficientMcpToolScope(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const authCtx = request.mcpAuth!;
  const toolScope = getMissingScopeForMcpBody(request.body, authCtx);

  if (!toolScope) {
    return false;
  }

  const scopeString = insufficientScopeString(toolScope.requiredScope, authCtx);
  const challenge = buildInsufficientScopeHeader(toolScope.requiredScope, authCtx);

  reply
    .code(403)
    .header('www-authenticate', challenge)
    .send({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: `Missing required scope: ${toolScope.requiredScope}`,
        // Mirror the OAuth Bearer error in the JSON-RPC body because some MCP
        // clients surface response bodies more reliably than auth headers.
        data: {
          error: 'insufficient_scope',
          required_scope: toolScope.requiredScope,
          scope: scopeString,
        },
      },
      id: toolScope.id,
    });

  return true;
}
