import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the workspace service before importing the module under test
vi.mock('../src/workspaces/service.js', () => ({
  listWorkspacesForUser: vi.fn(),
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { listWorkspacesForUser } from '../src/workspaces/service.js';
import { registerListWorkspacesTool } from '../src/mcp/tools/list-workspaces.js';

const mockedListWorkspaces = vi.mocked(listWorkspacesForUser);

interface ListWorkspacesStructuredContent {
  workspaces: Array<{ name: string }>;
}

interface TextContent {
  type: 'text';
  text: string;
}

/**
 * Creates a connected MCP client+server pair for testing tool calls.
 */
async function createTestClient(authCtx: { userId: string; scopes: string[] }) {
  const server = new McpServer(
    { name: 'test', version: '0.0.1' },
    { capabilities: { tools: {} } },
  );
  registerListWorkspacesTool(server, authCtx);

  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server, cleanup: async () => { await client.close(); await server.close(); } };
}

describe('registerListWorkspacesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array and "No workspaces found." when user has 0 workspaces', async () => {
    mockedListWorkspaces.mockResolvedValueOnce([]);

    const { client, cleanup } = await createTestClient({
      userId: 'user-no-ws',
      scopes: ['workspaces:read'],
    });

    const result = await client.callTool({ name: 'list_workspaces', arguments: {} });

    expect(mockedListWorkspaces).toHaveBeenCalledWith('user-no-ws');
    expect(result.structuredContent).toEqual({ workspaces: [] });
    expect(result.content).toEqual([
      { type: 'text', text: 'No workspaces found.' },
    ]);

    await cleanup();
  });

  it('returns workspaces and humanized summary when user has 2 workspaces', async () => {
    mockedListWorkspaces.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Acme Co', slug: 'acme-co', role: 'owner', createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-02') },
      { id: 'ws-2', name: 'Personal', slug: 'personal', role: 'member', createdAt: new Date('2025-02-01'), updatedAt: new Date('2025-02-02') },
    ]);

    const { client, cleanup } = await createTestClient({
      userId: 'user-2ws',
      scopes: ['workspaces:read'],
    });

    const result = await client.callTool({ name: 'list_workspaces', arguments: {} });

    expect(mockedListWorkspaces).toHaveBeenCalledWith('user-2ws');
    const structuredContent = result.structuredContent as ListWorkspacesStructuredContent;
    expect(structuredContent.workspaces).toHaveLength(2);
    expect(structuredContent.workspaces[0]!.name).toBe('Acme Co');
    expect(structuredContent.workspaces[1]!.name).toBe('Personal');
    expect(result.content).toEqual([
      { type: 'text', text: "Found 2 workspaces: 'Acme Co' (owner), 'Personal' (member)" },
    ]);

    await cleanup();
  });

  it('returns singular grammar when user has 1 workspace', async () => {
    mockedListWorkspaces.mockResolvedValueOnce([
      { id: 'ws-1', name: 'Solo', slug: 'solo', role: 'owner', createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01') },
    ]);

    const { client, cleanup } = await createTestClient({
      userId: 'user-1ws',
      scopes: ['workspaces:read'],
    });

    const result = await client.callTool({ name: 'list_workspaces', arguments: {} });

    expect(result.content).toEqual([
      { type: 'text', text: "Found 1 workspace: 'Solo' (owner)" },
    ]);

    await cleanup();
  });

  it('throws error when workspaces:read scope is missing', async () => {
    const { client, cleanup } = await createTestClient({
      userId: 'user-noscope',
      scopes: ['openid'],
    });

    const result = await client.callTool({ name: 'list_workspaces', arguments: {} });

    // MCP SDK wraps tool errors as isError: true with the error message in content
    expect(result.isError).toBe(true);
    const content = result.content as TextContent[];
    expect(content[0]!.text).toContain('Missing required scope: workspaces:read');

    // Service should never be called when scope check fails
    expect(mockedListWorkspaces).not.toHaveBeenCalled();

    await cleanup();
  });

  it('succeeds when workspaces:read scope is present among others', async () => {
    mockedListWorkspaces.mockResolvedValueOnce([]);

    const { client, cleanup } = await createTestClient({
      userId: 'user-multi',
      scopes: ['openid', 'profile', 'workspaces:read'],
    });

    const result = await client.callTool({ name: 'list_workspaces', arguments: {} });

    expect(result.structuredContent).toEqual({ workspaces: [] });

    await cleanup();
  });
});
