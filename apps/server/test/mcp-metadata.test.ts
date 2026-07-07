import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/workspaces/service.js', () => ({
  listWorkspacesForUser: vi.fn(),
}));
vi.mock('../src/projects/service.js', () => ({
  listAccessibleProjectsForUser: vi.fn(),
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/index.js';

async function createMetadataClient() {
  const server = createMcpServer({
    userId: 'metadata-user',
    scopes: ['workspaces:read', 'projects:read'],
  });
  const client = new Client({ name: 'metadata-test-client', version: '0.0.1' });
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

describe('MCP metadata', () => {
  it('identifies the service as App Starter during initialize', async () => {
    const { client, cleanup } = await createMetadataClient();

    expect(client.getServerVersion()).toMatchObject({
      name: 'app-starter',
      title: 'App Starter',
      description:
        'App Starter exposes authenticated workspace and project context to AI agents.',
    });
    expect(client.getInstructions()).toContain('not a Tailscale service');
    expect(client.getInstructions()).toContain('App Starter application workspaces');

    await cleanup();
  });

  it('publishes only product tools with explicit App Starter descriptions', async () => {
    const { client, cleanup } = await createMetadataClient();

    const result = await client.listTools();

    expect(result.tools).toHaveLength(2);
    expect(result.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'list_workspaces',
          title: 'List App Starter Workspaces',
          description:
            'List App Starter application workspaces the authenticated user belongs to. These are not Tailscale workspaces or network devices.',
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        }),
        expect.objectContaining({
          name: 'list_projects',
          title: 'List App Starter Projects',
          description:
            'List App Starter projects the authenticated user can access, optionally filtered by workspace slug.',
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        }),
      ]),
    );
    expect(result.tools.map((tool) => tool.name)).not.toContain('ping');

    await cleanup();
  });
});
