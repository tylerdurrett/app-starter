// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { db, projectMemberships, workspaces, workspaceMemberships } from '@repo/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/index.js';
import { createProject } from '../src/projects/service.js';
import { createWorkspace } from '../src/workspaces/service.js';
import { registerListProjectsTool } from '../src/mcp/tools/list-projects.js';

interface ProjectToolContent {
  projects: Array<Record<string, unknown>>;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    projects: Array<Record<string, unknown>>;
  }>;
}

const canonicalProjectKeys = [
  'createdAt',
  'id',
  'name',
  'role',
  'slug',
  'updatedAt',
  'workspaceId',
  'workspaceName',
  'workspaceSlug',
].sort();

let app: FastifyInstance;

async function signUpWithoutPersonalWorkspace(label: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: {
      email: `mcp-projects-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
      password: 'password123',
      name: `MCP ${label}`,
    },
  });
  const userId = JSON.parse(res.body).user.id as string;
  await db.delete(workspaces).where(eq(workspaces.createdByUserId, userId));
  return userId;
}

async function createWs(name: string, ownerUserId: string) {
  return createWorkspace({ name, ownerUserId });
}

async function createProj(name: string, workspaceId: string, ownerUserId: string) {
  return (await createProject({ name, workspaceId, ownerUserId }))!;
}

async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: 'owner' | 'manager' | 'member',
) {
  await db.insert(workspaceMemberships).values({
    id: `mcp-wm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    workspaceId,
    userId,
    role,
  });
}

async function addProjectMember(
  projectId: string,
  userId: string,
  role: 'owner' | 'manager' | 'member',
) {
  await db.insert(projectMemberships).values({
    id: `mcp-pm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId,
    userId,
    role,
  });
}

async function createTestClient(authCtx: { userId: string; scopes: string[] }) {
  const server = new McpServer({ name: 'test', version: '0.0.1' }, { capabilities: { tools: {} } });
  registerListProjectsTool(server, authCtx);

  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    cleanup: async () => {
      await client.close();
      await server.close();
    },
  };
}

beforeAll(async () => {
  app = buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('registerListProjectsTool', () => {
  it('returns canonical real-DB projects and preserves effective-role precedence', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('real-db-actor');
    const ownerId = await signUpWithoutPersonalWorkspace('real-db-owner');
    const workspace = await createWs('MCP Real DB Workspace', ownerId);
    const directProject = await createProj('MCP Direct Project', workspace.id, ownerId);
    const inheritedProject = await createProj('MCP Inherited Project', workspace.id, ownerId);
    await addWorkspaceMember(workspace.id, actorId, 'manager');
    await addProjectMember(directProject.id, actorId, 'member');

    const { client, cleanup } = await createTestClient({
      userId: actorId,
      scopes: ['openid', 'projects:read'],
    });
    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    const structured = result.structuredContent as unknown as ProjectToolContent;

    const direct = structured.projects.find((project) => project.id === directProject.id)!;
    const inherited = structured.projects.find((project) => project.id === inheritedProject.id)!;
    expect(direct).toMatchObject({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'member',
    });
    expect(inherited).toMatchObject({
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      role: 'owner',
    });
    expect(Object.keys(direct).sort()).toEqual(canonicalProjectKeys);
    expect(Object.keys(inherited).sort()).toEqual(canonicalProjectKeys);
    expect(structured.workspaces).toEqual([
      expect.objectContaining({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        projects: expect.arrayContaining([
          expect.objectContaining({ id: directProject.id }),
          expect.objectContaining({ id: inheritedProject.id }),
        ]),
      }),
    ]);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      `'${directProject.name}' (${workspace.name}, member)`,
    );

    await cleanup();
  });

  it('filters direct-only access by workspace without leaking siblings', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('filtered-actor');
    const ownerId = await signUpWithoutPersonalWorkspace('filtered-owner');
    const workspaceA = await createWs('MCP Filter Workspace A', ownerId);
    const workspaceB = await createWs('MCP Filter Workspace B', ownerId);
    const projectA = await createProj('MCP Filter Project A', workspaceA.id, ownerId);
    const siblingA = await createProj('MCP Filter Sibling A', workspaceA.id, ownerId);
    const projectB = await createProj('MCP Filter Project B', workspaceB.id, ownerId);
    await addProjectMember(projectA.id, actorId, 'manager');
    await addProjectMember(projectB.id, actorId, 'member');

    const { client, cleanup } = await createTestClient({
      userId: actorId,
      scopes: ['projects:read'],
    });
    const result = await client.callTool({
      name: 'list_projects',
      arguments: { workspaceSlug: workspaceA.slug },
    });
    const structured = result.structuredContent as unknown as ProjectToolContent;

    expect(structured.projects.map((project) => project.id)).toEqual([projectA.id]);
    expect(structured.projects.map((project) => project.id)).not.toContain(siblingA.id);
    expect(structured.projects.map((project) => project.id)).not.toContain(projectB.id);
    expect(structured.projects[0]).toMatchObject({
      workspaceSlug: workspaceA.slug,
      role: 'manager',
    });

    await cleanup();
  });

  it('returns grouped empty results when the actor has no accessible projects', async () => {
    const actorId = await signUpWithoutPersonalWorkspace('empty-actor');
    const { client, cleanup } = await createTestClient({
      userId: actorId,
      scopes: ['projects:read'],
    });

    const result = await client.callTool({ name: 'list_projects', arguments: {} });

    expect(result.structuredContent).toEqual({ projects: [], workspaces: [] });
    expect(result.content).toEqual([{ type: 'text', text: 'No accessible projects found.' }]);
    await cleanup();
  });

  it('rejects calls missing projects:read scope', async () => {
    const { client, cleanup } = await createTestClient({
      userId: 'scope-only-user',
      scopes: ['openid', 'workspaces:read'],
    });

    const result = await client.callTool({ name: 'list_projects', arguments: {} });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain(
      'Missing required scope: projects:read',
    );
    await cleanup();
  });
});
