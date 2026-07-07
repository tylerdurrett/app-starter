import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/projects/service.js', () => ({
  listAccessibleProjectsForUser: vi.fn(),
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { listAccessibleProjectsForUser } from '../src/projects/service.js';
import { registerListProjectsTool } from '../src/mcp/tools/list-projects.js';

const mockedListProjects = vi.mocked(listAccessibleProjectsForUser);

interface ProjectToolContent {
  projects: Array<{ name: string }>;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    projects: Array<{ name: string }>;
  }>;
}

async function createTestClient(authCtx: { userId: string; scopes: string[] }) {
  const server = new McpServer({ name: 'test', version: '0.0.1' }, { capabilities: { tools: {} } });
  registerListProjectsTool(server, authCtx);

  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    server,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe('registerListProjectsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns grouped empty results when user has no accessible projects', async () => {
    mockedListProjects.mockResolvedValueOnce([]);

    const { client, cleanup } = await createTestClient({
      userId: 'user-no-projects',
      scopes: ['projects:read'],
    });

    const result = await client.callTool({ name: 'list_projects', arguments: {} });

    expect(mockedListProjects).toHaveBeenCalledWith('user-no-projects', {
      workspaceSlug: undefined,
    });
    expect(result.structuredContent).toEqual({ projects: [], workspaces: [] });
    expect(result.content).toEqual([{ type: 'text', text: 'No accessible projects found.' }]);

    await cleanup();
  });

  it('returns projects grouped by workspace and a human summary', async () => {
    const createdAt = new Date('2025-01-01');
    const updatedAt = new Date('2025-01-02');
    mockedListProjects.mockResolvedValueOnce([
      {
        id: 'project-1',
        name: 'Roadmap',
        slug: 'roadmap',
        role: 'owner',
        access: 'workspace_admin',
        createdAt,
        updatedAt,
        workspace: { id: 'workspace-1', name: 'Acme Co', slug: 'acme-co' },
      },
      {
        id: 'project-2',
        name: 'Support',
        slug: 'support',
        role: 'member',
        access: 'project_membership',
        createdAt,
        updatedAt,
        workspace: { id: 'workspace-1', name: 'Acme Co', slug: 'acme-co' },
      },
    ]);

    const { client, cleanup } = await createTestClient({
      userId: 'user-projects',
      scopes: ['openid', 'projects:read'],
    });

    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    const structuredContent = result.structuredContent as ProjectToolContent;

    expect(structuredContent.projects).toHaveLength(2);
    expect(structuredContent.workspaces).toEqual([
      expect.objectContaining({
        id: 'workspace-1',
        name: 'Acme Co',
        slug: 'acme-co',
        projects: expect.arrayContaining([
          expect.objectContaining({ name: 'Roadmap' }),
          expect.objectContaining({ name: 'Support' }),
        ]),
      }),
    ]);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: "Found 2 projects across 1 workspace: 'Roadmap' (Acme Co, owner), 'Support' (Acme Co, member)",
      },
    ]);

    await cleanup();
  });

  it('passes optional workspaceSlug to the project service', async () => {
    mockedListProjects.mockResolvedValueOnce([]);

    const { client, cleanup } = await createTestClient({
      userId: 'user-filtered',
      scopes: ['projects:read'],
    });

    const result = await client.callTool({
      name: 'list_projects',
      arguments: { workspaceSlug: 'acme-co' },
    });

    expect(mockedListProjects).toHaveBeenCalledWith('user-filtered', {
      workspaceSlug: 'acme-co',
    });
    expect(result.content).toEqual([
      { type: 'text', text: "No accessible projects found in workspace 'acme-co'." },
    ]);

    await cleanup();
  });

  it('rejects calls missing projects:read scope before querying projects', async () => {
    const { client, cleanup } = await createTestClient({
      userId: 'user-noscope',
      scopes: ['openid', 'workspaces:read'],
    });

    const result = await client.callTool({ name: 'list_projects', arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      'Missing required scope: projects:read',
    );
    expect(mockedListProjects).not.toHaveBeenCalled();

    await cleanup();
  });
});
