// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildServer } from '../src/index.js';
import { db, integrations, workspaces, workspaceMemberships } from '@repo/db';
import { inArray, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { parseJsonBody } from './helpers.js';

interface SignUpBody {
  user: { id: string };
}

interface WorkspaceBody {
  id: string;
  slug: string;
}

interface IntegrationBody {
  id: string;
  name: string;
  type: string;
  status: string;
  config: {
    botToken?: string;
    signingSecret?: string;
  };
}

let app: FastifyInstance;

let ownerCookie: string;
let memberCookie: string;
let memberId: string;
let nonMemberCookie: string;

let testWorkspaceId: string;
let testWorkspaceSlug: string;

const createdIntegrationIds: string[] = [];

/** Sign up a user and return their ID + session cookie. */
async function signUp(email: string, name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email, password: 'password123', name },
  });
  const body = parseJsonBody<SignUpBody>(res);
  const setCookie = res.headers['set-cookie'] as string;
  return { userId: body.user.id, cookie: setCookie.split(';')[0] };
}

/** Create a workspace and add members */
async function setupTestWorkspace() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/workspaces',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    payload: { name: 'Integration Test Workspace' },
  });
  const body = parseJsonBody<WorkspaceBody>(res);
  testWorkspaceId = body.id;
  testWorkspaceSlug = body.slug;

  // Add member user to workspace
  await db.insert(workspaceMemberships).values({
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    workspaceId: testWorkspaceId,
    userId: memberId,
    role: 'member',
  });
}

beforeAll(async () => {
  app = buildServer();
  await app.ready();

  const ts = Date.now();

  // Create owner user
  const owner = await signUp(`owner-int-${ts}@test.com`, 'Owner');
  ownerCookie = owner.cookie;

  // Create member user
  const member = await signUp(`member-int-${ts}@test.com`, 'Member');
  memberCookie = member.cookie;
  memberId = member.userId;

  // Create non-member user
  const nonMember = await signUp(`nonmember-int-${ts}@test.com`, 'NonMember');
  nonMemberCookie = nonMember.cookie;

  await setupTestWorkspace();
});

afterAll(async () => {
  // Clean up created integrations
  if (createdIntegrationIds.length > 0) {
    await db.delete(integrations).where(inArray(integrations.id, createdIntegrationIds)).catch(() => {});
  }

  // Clean up workspace
  if (testWorkspaceId) {
    await db.delete(workspaces).where(eq(workspaces.id, testWorkspaceId)).catch(() => {});
  }

  await app.close();
});

beforeEach(() => {
  // Reset fetch mock before each test
  vi.unstubAllGlobals();
});

describe('POST /api/workspaces/:workspaceSlug/integrations', () => {
  it('creates an integration with masked credentials and returns 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      payload: {
        type: 'slack',
        name: 'Test Slack Integration',
        config: {
          botToken: 'xoxb-test-token-123456789',
          signingSecret: 'test-secret-abcdef123456',
        },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = parseJsonBody<IntegrationBody>(res);
    expect(body.name).toBe('Test Slack Integration');
    expect(body.type).toBe('slack');
    expect(body.status).toBe('pending');
    expect(body.config.botToken).toMatch(/^••••••••/);
    expect(body.config.signingSecret).toMatch(/^••••••••/);

    createdIntegrationIds.push(body.id);
  });

  it('returns 403 when member tries to create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { 'content-type': 'application/json', cookie: memberCookie },
      payload: {
        type: 'slack',
        name: 'Should Fail',
        config: {
          botToken: 'xoxb-test-token',
          signingSecret: 'test-secret',
        },
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { 'content-type': 'application/json' },
      payload: {
        type: 'slack',
        name: 'No Auth',
        config: {},
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when non-member tries to create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { 'content-type': 'application/json', cookie: nonMemberCookie },
      payload: {
        type: 'slack',
        name: 'Non-member',
        config: {
          botToken: 'xoxb-test',
          signingSecret: 'secret',
        },
      },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/workspaces/:workspaceSlug/integrations', () => {
  it('returns list of integrations', async () => {
    // Create an integration first
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      payload: {
        type: 'slack',
        name: 'List Test Integration',
        config: {
          botToken: 'xoxb-list-test-token',
          signingSecret: 'list-test-secret',
        },
      },
    });
    const created = parseJsonBody<IntegrationBody>(createRes);
    createdIntegrationIds.push(created.id);

    // List integrations
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = parseJsonBody<IntegrationBody[]>(res);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body.some((integration) => integration.id === created.id)).toBe(true);
  });

  it('allows member to list integrations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { cookie: memberCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 404 for non-member', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { cookie: nonMemberCookie },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/workspaces/:workspaceSlug/integrations/:integrationId/test', () => {
  let testIntegrationId: string;

  beforeEach(async () => {
    // Create an integration for testing
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      payload: {
        type: 'slack',
        name: 'Test Connection Integration',
        config: {
          botToken: 'xoxb-test-connection-token',
          signingSecret: 'test-connection-secret',
        },
      },
    });
    const created = JSON.parse(createRes.body);
    testIntegrationId = created.id;
    createdIntegrationIds.push(created.id);
  });

  it('tests integration successfully with mocked Slack API', async () => {
    // Mock successful Slack auth.test response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        team: 'Test Team',
        team_id: 'T12345',
        user: 'testbot',
        user_id: 'U12345',
        bot_id: 'B12345',
      }),
    }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${testIntegrationId}/test`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('active');
    expect(body.lastTestedAt).toBeDefined();
    expect(body.info).toMatchObject({
      team: 'Test Team',
      teamId: 'T12345',
      user: 'testbot',
      userId: 'U12345',
      botId: 'B12345',
    });
  });

  it('handles Slack auth failure', async () => {
    // Mock failed Slack auth.test response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: false,
        error: 'invalid_auth',
      }),
    }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${testIntegrationId}/test`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('error');
    expect(body.error).toBe('invalid_auth');
  });

  it('returns 403 when member tries to test', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${testIntegrationId}/test`,
      headers: { cookie: memberCookie },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /api/workspaces/:workspaceSlug/integrations/:integrationId', () => {
  let patchIntegrationId: string;

  beforeEach(async () => {
    // Create an integration for testing
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      payload: {
        type: 'slack',
        name: 'Patch Test Integration',
        config: {
          botToken: 'xoxb-patch-test-token',
          signingSecret: 'patch-test-secret',
        },
      },
    });
    const created = JSON.parse(createRes.body);
    patchIntegrationId = created.id;
    createdIntegrationIds.push(created.id);
  });

  it('updates integration and automatically retests with new config', async () => {
    // Mock failed Slack auth.test response for the auto-retest
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: false,
        error: 'invalid_auth',
      }),
    }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${patchIntegrationId}`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      payload: {
        name: 'Updated Name',
        config: {
          botToken: 'xoxb-updated-token',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('Updated Name');
    expect(body.status).toBe('error'); // Auto-retest failed
    expect(body.config.botToken).toMatch(/^••••••••/); // Still masked
  });

  it('updates only name without triggering retest', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${patchIntegrationId}`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      payload: {
        name: 'Name Only Update',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('Name Only Update');
  });

  it('returns 403 when member tries to update', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${patchIntegrationId}`,
      headers: { 'content-type': 'application/json', cookie: memberCookie },
      payload: {
        name: 'Should Fail',
      },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /api/workspaces/:workspaceSlug/integrations/:integrationId', () => {
  it('deletes integration and returns 204', async () => {
    // Create an integration to delete
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      payload: {
        type: 'slack',
        name: 'Delete Test Integration',
        config: {
          botToken: 'xoxb-delete-test-token',
          signingSecret: 'delete-test-secret',
        },
      },
    });
    const created = JSON.parse(createRes.body);
    // Don't add to createdIntegrationIds since we're deleting it

    // Delete the integration
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${created.id}`,
      headers: { cookie: ownerCookie },
    });

    expect(deleteRes.statusCode).toBe(204);

    // Verify it's gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${created.id}`,
      headers: { cookie: ownerCookie },
    });

    expect(getRes.statusCode).toBe(404);
  });

  it('returns 403 when member tries to delete', async () => {
    // Create an integration
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      payload: {
        type: 'slack',
        name: 'Member Delete Test',
        config: {
          botToken: 'xoxb-member-delete-token',
          signingSecret: 'member-delete-secret',
        },
      },
    });
    const created = JSON.parse(createRes.body);
    createdIntegrationIds.push(created.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${created.id}`,
      headers: { cookie: memberCookie },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when integration does not exist', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/non-existent-id`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/workspaces/:workspaceSlug/integrations/:integrationId', () => {
  let getIntegrationId: string;

  beforeAll(async () => {
    // Create an integration once for all tests in this describe block
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations`,
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      payload: {
        type: 'slack',
        name: 'Get Test Integration',
        config: {
          botToken: 'xoxb-get-test-token',
          signingSecret: 'get-test-secret-16chars',
        },
      },
    });

    // Check if creation was successful
    if (createRes.statusCode !== 201) {
      throw new Error(`Failed to create integration for GET tests: ${createRes.body}`);
    }

    const created = JSON.parse(createRes.body);
    getIntegrationId = created.id;
    createdIntegrationIds.push(created.id);
  });

  it('returns integration with masked credentials', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${getIntegrationId}`,
      headers: { cookie: ownerCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(getIntegrationId);
    expect(body.name).toBe('Get Test Integration');
    expect(body.config.botToken).toMatch(/^••••••••/);
    expect(body.config.signingSecret).toMatch(/^••••••••/);
  });

  it('allows member to get integration', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${getIntegrationId}`,
      headers: { cookie: memberCookie },
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 404 for non-member', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/workspaces/${testWorkspaceSlug}/integrations/${getIntegrationId}`,
      headers: { cookie: nonMemberCookie },
    });

    expect(res.statusCode).toBe(404);
  });
});
