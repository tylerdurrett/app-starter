import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/projects/resolver.js', () => ({
  listAuthorizedProjectsForUser: vi.fn(),
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { listAuthorizedProjectsForUser } from '../src/projects/resolver.js';
import { registerListProjectsTool } from '../src/mcp/tools/list-projects.js';

const mockedListProjects = vi.mocked(listAuthorizedProjectsForUser);

interface ProjectToolContent {
  projects: Array<Record<string, unknown>>;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    projects: Array<Record<string, unknown>>;
  }>;
}

const createdAt = new Date('2025-01-01T00:00:00.000Z');
const updatedAt = new Date('2025-01-02T00:00:00.000Z');

const roadmapProject = {
  id: 'project-1',
  name: 'Roadmap',
  slug: 'roadmap',
  workspaceId: 'workspace-1',
  workspaceSlug: 'acme-co',
  workspaceName: 'Acme Co',
  createdAt,
  updatedAt,
  role: 'owner' as const,
};

const supportProject = {
  id: 'project-2',
  name: 'Support',
  slug: 'support',
  workspaceId: 'workspace-2',
  workspaceSlug: 'support-co',
  workspaceName: 'Support Co',
  createdAt,
  updatedAt,
  role: 'member' as const,
};

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

    expect(mockedListProjects).toHaveBeenCalledWith('user-no-projects');
    expect(result.structuredContent).toEqual({ projects: [], workspaces: [] });
    expect(result.content).toEqual([{ type: 'text', text: 'No accessible projects found.' }]);

    await cleanup();
  });

  it('returns flat canonical projects grouped across workspaces with a human summary', async () => {
    mockedListProjects.mockResolvedValueOnce([roadmapProject, supportProject]);

    const { client, cleanup } = await createTestClient({
      userId: 'user-projects',
      scopes: ['openid', 'projects:read'],
    });

    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    const structuredContent = result.structuredContent as ProjectToolContent;

    expect(structuredContent.projects).toEqual([roadmapProject, supportProject]);
    expect(structuredContent.workspaces).toEqual([
      {
        id: 'workspace-1',
        name: 'Acme Co',
        slug: 'acme-co',
        projects: [roadmapProject],
      },
      {
        id: 'workspace-2',
        name: 'Support Co',
        slug: 'support-co',
        projects: [supportProject],
      },
    ]);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: "Found 2 projects across 2 workspaces: 'Roadmap' (Acme Co, owner), 'Support' (Support Co, member)",
      },
    ]);

    for (const project of [
      ...structuredContent.projects,
      ...structuredContent.workspaces.flatMap((workspace) => workspace.projects),
    ]) {
      expect(Object.keys(project).sort()).toEqual(
        [
          'createdAt',
          'id',
          'name',
          'role',
          'slug',
          'updatedAt',
          'workspaceId',
          'workspaceName',
          'workspaceSlug',
        ].sort(),
      );
      expect(project).not.toHaveProperty('access');
      expect(project).not.toHaveProperty('workspace');
    }

    await cleanup();
  });

  it('passes optional workspaceSlug to the project resolver', async () => {
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

  it('displays the resolver-provided effective role without recalculating it', async () => {
    mockedListProjects.mockResolvedValueOnce([{ ...roadmapProject, role: 'member' }]);

    const { client, cleanup } = await createTestClient({
      userId: 'user-effective-role',
      scopes: ['projects:read'],
    });

    const result = await client.callTool({ name: 'list_projects', arguments: {} });

    expect(result.content).toEqual([
      {
        type: 'text',
        text: "Found 1 project across 1 workspace: 'Roadmap' (Acme Co, member)",
      },
    ]);
    expect(result.structuredContent).toMatchObject({
      projects: [{ role: 'member' }],
      workspaces: [{ projects: [{ role: 'member' }] }],
    });

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
