import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// Mock jose before importing the module under test
vi.mock('jose', () => {
  const mockJwks = vi.fn();
  return {
    createRemoteJWKSet: vi.fn(() => mockJwks),
    jwtVerify: vi.fn(),
  };
});

// Import after mock setup
import { jwtVerify } from 'jose';
import {
  buildInsufficientScopeHeader,
  getRequiredScopeForMcpBody,
  rejectInsufficientMcpToolScope,
  verifyMcpRequest,
} from '../src/mcp/auth.js';
import { requireScope, InsufficientScopeError } from '../src/mcp/scopes.js';
import { config } from '../src/config.js';

const mockedJwtVerify = vi.mocked(jwtVerify);
type MockJwtVerifyResult = Awaited<ReturnType<typeof jwtVerify>>;

function jwtResult(payload: MockJwtVerifyResult['payload']): MockJwtVerifyResult {
  return {
    payload,
    protectedHeader: { alg: 'EdDSA', kid: 'test-kid' },
  };
}

function buildTestApp() {
  const app = Fastify();

  // Register a test route with the MCP auth preHandler
  app.post('/mcp-test', { preHandler: verifyMcpRequest }, async (request) => {
    return { ok: true, mcpAuth: request.mcpAuth };
  });

  app.post('/mcp-tool-test', { preHandler: verifyMcpRequest }, async (request, reply) => {
    if (rejectInsufficientMcpToolScope(request, reply)) return;
    return { ok: true };
  });

  return app;
}

describe('verifyMcpRequest', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    app = buildTestApp();
    // Custom dev origins in .env should not leak queued JWT mock results
    // between cases when an earlier origin check short-circuits verification.
    mockedJwtVerify.mockReset();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 401 with WWW-Authenticate when Authorization header is missing', async () => {
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-test',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer resource_metadata="/);
    expect(res.headers['www-authenticate']).toContain('scope="workspaces:read projects:read"');
    expect(res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when Authorization header is not Bearer scheme', async () => {
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Basic dXNlcjpwYXNz',
      },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer /);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when token is expired', async () => {
    mockedJwtVerify.mockRejectedValueOnce(new Error('JWT expired'));

    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer expired-token',
      },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer /);
  });

  it('returns 401 when audience claim is wrong', async () => {
    mockedJwtVerify.mockRejectedValueOnce(new Error('unexpected "aud" claim value'));

    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong-audience-token',
      },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer /);
  });

  it('returns 401 when issuer claim is wrong', async () => {
    mockedJwtVerify.mockRejectedValueOnce(new Error('unexpected "iss" claim value'));

    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer wrong-issuer-token',
      },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer /);
  });

  it('returns 401 when signature is invalid', async () => {
    mockedJwtVerify.mockRejectedValueOnce(new Error('signature verification failed'));

    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer invalid-sig-token',
      },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer /);
  });

  it('returns 403 when Origin header is present but invalid', async () => {
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer some-token',
        origin: 'http://evil.example.com',
      },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Forbidden: invalid origin' });
    // jwtVerify should not have been called — origin check happens first
    expect(mockedJwtVerify).not.toHaveBeenCalled();
  });

  it('returns 200 with mcpAuth when token is valid and no Origin header', async () => {
    mockedJwtVerify.mockResolvedValueOnce(
      jwtResult({
        sub: 'user-123',
        scope: 'openid workspaces:read',
        iss: 'http://localhost:5100',
        aud: 'http://localhost:5100/mcp',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );

    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-token',
      },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      mcpAuth: {
        userId: 'user-123',
        scopes: ['openid', 'workspaces:read'],
      },
    });
  });

  it('returns 200 with mcpAuth when token is valid and Origin matches allowed origin', async () => {
    mockedJwtVerify.mockResolvedValueOnce(
      jwtResult({
        sub: 'user-456',
        scope: 'workspaces:read',
        iss: 'http://localhost:5100',
        aud: 'http://localhost:5100/mcp',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );

    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-token',
        origin: config.webOrigin,
      },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      mcpAuth: {
        userId: 'user-456',
        scopes: ['workspaces:read'],
      },
    });
  });

  it('handles token with empty scope claim', async () => {
    mockedJwtVerify.mockResolvedValueOnce(
      jwtResult({
        sub: 'user-789',
        scope: '',
        iss: 'http://localhost:5100',
        aud: 'http://localhost:5100/mcp',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );

    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-no-scope-token',
      },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      mcpAuth: {
        userId: 'user-789',
        scopes: [],
      },
    });
  });
});

describe('requireScope', () => {
  it('does not throw when scope is present', () => {
    const authCtx = { userId: 'user-1', scopes: ['openid', 'workspaces:read'] };
    expect(() => requireScope('workspaces:read', authCtx)).not.toThrow();
  });

  it('throws InsufficientScopeError when scope is missing', () => {
    const authCtx = { userId: 'user-1', scopes: ['openid'] };
    expect(() => requireScope('workspaces:read', authCtx)).toThrow(InsufficientScopeError);
    expect(() => requireScope('workspaces:read', authCtx)).toThrow(
      'Missing required scope: workspaces:read',
    );
  });

  it('throws InsufficientScopeError when scopes array is empty', () => {
    const authCtx = { userId: 'user-1', scopes: [] };
    expect(() => requireScope('workspaces:read', authCtx)).toThrow(InsufficientScopeError);
  });
});

describe('MCP tool scope challenges', () => {
  it('detects the required scope for known tool calls', () => {
    expect(
      getRequiredScopeForMcpBody({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
      }),
    ).toEqual({ id: 7, requiredScope: 'projects:read' });

    expect(
      getRequiredScopeForMcpBody({
        jsonrpc: '2.0',
        id: 'abc',
        method: 'tools/call',
        params: { name: 'list_workspaces', arguments: {} },
      }),
    ).toEqual({ id: 'abc', requiredScope: 'workspaces:read' });

    expect(getRequiredScopeForMcpBody({ method: 'tools/list' })).toBeNull();
  });

  it('builds an insufficient_scope challenge preserving already-granted MCP scopes', () => {
    const header = buildInsufficientScopeHeader('projects:read', {
      userId: 'user-1',
      scopes: ['openid', 'workspaces:read'],
    });

    expect(header).toContain('error="insufficient_scope"');
    expect(header).toContain('scope="workspaces:read projects:read"');
    expect(header).toContain('Missing required scope: projects:read');
  });

  it('returns HTTP 403 with WWW-Authenticate when a tool scope is missing', async () => {
    const app = buildTestApp();
    mockedJwtVerify.mockResolvedValueOnce(
      jwtResult({
        sub: 'user-step-up',
        scope: 'openid workspaces:read',
        iss: 'http://localhost:5100',
        aud: 'http://localhost:5100/mcp',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );

    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-tool-test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-token',
      },
      payload: {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers['www-authenticate']).toContain('error="insufficient_scope"');
    expect(res.headers['www-authenticate']).toContain('scope="workspaces:read projects:read"');
    expect(res.json()).toEqual({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Missing required scope: projects:read',
        data: {
          error: 'insufficient_scope',
          required_scope: 'projects:read',
          scope: 'workspaces:read projects:read',
        },
      },
      id: 9,
    });

    await app.close();
  });

  it('rejects a batched request when any tool call is missing scope', async () => {
    const app = buildTestApp();
    mockedJwtVerify.mockResolvedValueOnce(
      jwtResult({
        sub: 'user-batch-step-up',
        scope: 'workspaces:read',
        iss: 'http://localhost:5100',
        aud: 'http://localhost:5100/mcp',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );

    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/mcp-tool-test',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-token',
      },
      payload: [
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_workspaces', arguments: {} },
        },
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'list_projects', arguments: {} },
        },
      ],
    });

    expect(res.statusCode).toBe(403);
    expect(res.headers['www-authenticate']).toContain('error="insufficient_scope"');
    expect(res.json()).toMatchObject({
      error: {
        data: {
          error: 'insufficient_scope',
          required_scope: 'projects:read',
        },
      },
      id: 2,
    });

    await app.close();
  });
});
