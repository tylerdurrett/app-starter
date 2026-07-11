import { afterEach, describe, expect, it, vi } from 'vitest';
import { mcpConnectorSchema } from '@repo/shared';

// Well-formed reference payload matching the shared API contract.
const validMcpConnector = {
  url: 'https://mcp.example.com/connect',
};

// A schema drift must fail loudly, never silently.
describe('me contract schemas', () => {
  it('accepts the well-formed reference payload', () => {
    expect(() => mcpConnectorSchema.parse(validMcpConnector)).not.toThrow();
  });

  it('throws on a McpConnector missing the url field', () => {
    expect(() => mcpConnectorSchema.parse({})).toThrow();
  });

  it('throws on a McpConnector with a renamed url field', () => {
    expect(() => mcpConnectorSchema.parse({ href: 'https://mcp.example.com' })).toThrow();
  });

  it('throws on a McpConnector with a wrong-typed url field', () => {
    expect(() => mcpConnectorSchema.parse({ url: 42 })).toThrow();
  });
});

// Prove the drift throws through the real fetch boundary (apiFetchParsed), not
// just when calling the schema directly.
describe('apiFetchParsed boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadApiReturning(body: unknown) {
    vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => body,
      }),
    );
    vi.resetModules();
    return import('./api');
  }

  it('rejects when the server returns a malformed me/mcp-connector response', async () => {
    const { apiFetchParsed } = await loadApiReturning({ url: 42 });
    await expect(
      apiFetchParsed('/api/me/mcp-connector', mcpConnectorSchema),
    ).rejects.toThrow();
  });

  it('resolves when the server returns a well-formed me/mcp-connector response', async () => {
    const { apiFetchParsed } = await loadApiReturning(validMcpConnector);
    await expect(
      apiFetchParsed('/api/me/mcp-connector', mcpConnectorSchema),
    ).resolves.toEqual(validMcpConnector);
  });
});
