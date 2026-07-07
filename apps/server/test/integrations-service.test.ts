// Ensure .env is loaded before @repo/db reads DATABASE_URL
import '../src/config.js';

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../src/index.js';
import { db, integrations, workspaces, workspaceMemberships } from '@repo/db';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import {
  createIntegration,
  listIntegrations,
  getIntegration,
  updateIntegration,
  deleteIntegration,
  testIntegration,
  ServiceError,
} from '../src/integrations/service.js';
import { expectServiceError, parseJsonBody } from './helpers.js';

import { isEncrypted } from '../src/integrations/crypto.js';

// ---- helpers ----

let app: FastifyInstance;
let ownerId: string;
let managerId: string;
let memberId: string;
let nonMemberId: string;
let workspaceId: string;
let workspaceSlug: string;
const createdIntegrationIds: string[] = [];

/** Sign up a user via the auth endpoint and return their ID. */
async function signUp(email: string, name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: { email, password: 'password123', name },
  });
  const body = parseJsonBody<{ user: { id: string } }>(res);
  return body.user.id;
}

/** Create a workspace and add members with specific roles. */
async function setupWorkspace() {
  const id = randomUUID();
  const slug = `test-workspace-${Date.now()}`;

  await db.insert(workspaces).values({
    id,
    name: 'Test Workspace',
    slug,
    createdByUserId: ownerId,
  });

  // Add owner membership
  await db.insert(workspaceMemberships).values({
    id: randomUUID(),
    workspaceId: id,
    userId: ownerId,
    role: 'owner',
  });

  // Add manager membership
  await db.insert(workspaceMemberships).values({
    id: randomUUID(),
    workspaceId: id,
    userId: managerId,
    role: 'manager',
  });

  // Add member membership
  await db.insert(workspaceMemberships).values({
    id: randomUUID(),
    workspaceId: id,
    userId: memberId,
    role: 'member',
  });

  workspaceId = id;
  workspaceSlug = slug;
}

// ---- setup / teardown ----

beforeAll(async () => {
  app = buildServer();
  await app.ready();

  const ts = Date.now();
  ownerId = await signUp(`owner-int-${ts}@test.com`, 'Owner');
  managerId = await signUp(`manager-int-${ts}@test.com`, 'Manager');
  memberId = await signUp(`member-int-${ts}@test.com`, 'Member');
  nonMemberId = await signUp(`nonmember-int-${ts}@test.com`, 'NonMember');

  await setupWorkspace();
});

beforeEach(() => {
  // Mock fetch for Slack API calls
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  // Clean up integrations
  if (createdIntegrationIds.length > 0) {
    await db.delete(integrations).where(inArray(integrations.id, createdIntegrationIds)).catch(() => {});
  }
  // Clean up workspace (memberships cascade)
  if (workspaceId) {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId)).catch(() => {});
  }
  await app.close();
});

// ---- tests ----

describe('createIntegration', () => {
  it('should create an integration with encrypted credentials', async () => {
    const integration = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Test Slack',
      config: {
        botToken: 'xoxb-test-token-123456789',
        signingSecret: '0123456789abcdef',
      },
    });

    createdIntegrationIds.push(integration.id);

    expect(integration.name).toBe('Test Slack');
    expect(integration.type).toBe('slack');
    expect(integration.status).toBe('pending');

    // Verify credentials are masked in the response
    expect(integration.config.botToken).toBe('••••••••6789');
    expect(integration.config.signingSecret).toBe('••••••••cdef');

    // Direct DB check - credentials should be encrypted
    const [dbRow] = await db
      .select()
      .from(integrations)
      .where(eq(integrations.id, integration.id));

    const dbConfig = dbRow.config as Record<string, unknown>;
    expect(isEncrypted(dbConfig.botToken)).toBe(true);
    expect(isEncrypted(dbConfig.signingSecret)).toBe(true);
  });

  it('should validate Slack configuration', async () => {
    await expect(
      createIntegration(workspaceSlug, ownerId, {
        type: 'slack',
        name: 'Invalid Slack',
        config: {
          botToken: 'invalid-token', // Missing xoxb- prefix
          signingSecret: 'short', // Too short
        },
      })
    ).rejects.toThrow(ServiceError);
  });

  it('should reject unknown integration type', async () => {
    await expect(
      createIntegration(workspaceSlug, ownerId, {
        type: 'unknown',
        name: 'Unknown Integration',
        config: {},
      })
    ).rejects.toThrow('Unknown integration type');
  });
});

describe('listIntegrations', () => {
  it('should list all integrations in a workspace', async () => {
    const int1 = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Slack 1',
      config: {
        botToken: 'xoxb-token-111',
        signingSecret: '1111111111111111',
      },
    });
    createdIntegrationIds.push(int1.id);

    const int2 = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Slack 2',
      config: {
        botToken: 'xoxb-token-222',
        signingSecret: '2222222222222222',
      },
    });
    createdIntegrationIds.push(int2.id);

    const list = await listIntegrations(workspaceSlug, ownerId);

    expect(list.length).toBeGreaterThanOrEqual(2);
    const ids = list.map(i => i.id);
    expect(ids).toContain(int1.id);
    expect(ids).toContain(int2.id);

    // All credentials should be masked
    for (const integration of list) {
      if (integration.type === 'slack') {
        expect(integration.config.botToken).toMatch(/^••••••••/);
        expect(integration.config.signingSecret).toMatch(/^••••••••/);
      }
    }
  });

  it('should return empty array for workspace with no integrations', async () => {
    const emptyWorkspaceId = randomUUID();
    const emptyWorkspaceSlug = `empty-${Date.now()}`;

    await db.insert(workspaces).values({
      id: emptyWorkspaceId,
      name: 'Empty Workspace',
      slug: emptyWorkspaceSlug,
      createdByUserId: ownerId,
    });

    await db.insert(workspaceMemberships).values({
      id: randomUUID(),
      workspaceId: emptyWorkspaceId,
      userId: ownerId,
      role: 'owner',
    });

    const list = await listIntegrations(emptyWorkspaceSlug, ownerId);
    expect(list).toEqual([]);

    // Cleanup
    await db.delete(workspaces).where(eq(workspaces.id, emptyWorkspaceId));
  });

  it('flags rows with undecryptable credentials instead of throwing', async () => {
    const goodInt = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Readable integration',
      config: {
        botToken: 'xoxb-token-readable',
        signingSecret: 'readablesecret123',
      },
    });
    createdIntegrationIds.push(goodInt.id);

    const brokenId = randomUUID();
    const brokenConfig = {
      botToken: {
        v: 1 as const,
        iv: Buffer.from('aaaaaaaaaaaa', 'utf8').toString('base64'),
        tag: Buffer.from('bbbbbbbbbbbbbbbb', 'utf8').toString('base64'),
        ct: Buffer.from('deadbeef', 'utf8').toString('base64'),
      },
      signingSecret: {
        v: 1 as const,
        iv: Buffer.from('cccccccccccc', 'utf8').toString('base64'),
        tag: Buffer.from('dddddddddddddddd', 'utf8').toString('base64'),
        ct: Buffer.from('cafebabe', 'utf8').toString('base64'),
      },
      name: 'Broken integration',
    };
    await db.insert(integrations).values({
      id: brokenId,
      workspaceId,
      type: 'slack',
      name: 'Broken integration',
      config: brokenConfig,
      status: 'error',
      createdByUserId: ownerId,
    });
    createdIntegrationIds.push(brokenId);

    const list = await listIntegrations(workspaceSlug, ownerId);

    const broken = list.find(i => i.id === brokenId);
    expect(broken).toBeDefined();
    expect(broken!.credentialsReadable).toBe(false);
    // Raw EncryptedField envelopes must not leak into the response.
    expect(isEncrypted(broken!.config.botToken)).toBe(false);
    expect(isEncrypted(broken!.config.signingSecret)).toBe(false);
    // Non-credential fields in the raw config still come through.
    expect(broken!.config.name).toBe('Broken integration');

    const readable = list.find(i => i.id === goodInt.id);
    expect(readable).toBeDefined();
    expect(readable!.credentialsReadable).toBe(true);
  });
});

describe('getIntegration', () => {
  it('should get a single integration with masked credentials', async () => {
    const created = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Get Test',
      config: {
        botToken: 'xoxb-get-test-123',
        signingSecret: 'gettestsecret123',
      },
    });
    createdIntegrationIds.push(created.id);

    const fetched = await getIntegration(workspaceSlug, created.id, ownerId);

    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('Get Test');
    expect(fetched.config.botToken).toBe('••••••••-123');
    expect(fetched.config.signingSecret).toBe('••••••••t123');
  });

  it('should throw NOT_FOUND for non-existent integration', async () => {
    await expect(
      getIntegration(workspaceSlug, 'non-existent-id', ownerId)
    ).rejects.toThrow(ServiceError);

    try {
      await getIntegration(workspaceSlug, 'non-existent-id', ownerId);
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).code).toBe('NOT_FOUND');
    }
  });
});

describe('updateIntegration', () => {
  it('should update integration name without changing credentials', async () => {
    const created = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Original Name',
      config: {
        botToken: 'xoxb-update-test-456',
        signingSecret: 'updatesecret4567',
      },
    });
    createdIntegrationIds.push(created.id);

    const updated = await updateIntegration(workspaceSlug, created.id, ownerId, {
      name: 'Updated Name',
    });

    expect(updated.name).toBe('Updated Name');
    expect(updated.status).toBe('pending'); // Should not change
    expect(updated.config.botToken).toBe('••••••••-456');
  });

  it('should update credentials and auto-test with success', async () => {
    const created = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Auto Test Integration',
      config: {
        botToken: 'xoxb-old-token-789',
        signingSecret: 'oldsecret7890123',
      },
    });
    createdIntegrationIds.push(created.id);

    // Mock successful Slack auth.test
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        team: 'Test Team',
        team_id: 'T123',
        user: 'testbot',
        user_id: 'U123',
        bot_id: 'B123',
        url: 'https://test-team.slack.com/',
      }),
    } as Response);

    const updated = await updateIntegration(workspaceSlug, created.id, ownerId, {
      config: {
        botToken: 'xoxb-new-token-999',
      },
    });

    expect(updated.status).toBe('active'); // Auto-tested and succeeded
    expect(updated.config.botToken).toBe('••••••••-999');
    expect(updated.lastTestedAt).toBeTruthy();

    // slackMeta should be visible in masked response (not a credential, passes through unmasked)
    expect(updated.config.slackMeta).toEqual({
      teamUrl: 'https://test-team.slack.com/',
      teamId: 'T123',
      team: 'Test Team',
    });
  });

  it('should update credentials and auto-test with failure', async () => {
    const created = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Auto Test Fail',
      config: {
        botToken: 'xoxb-good-token-111',
        signingSecret: 'goodsecret111111',
      },
    });
    createdIntegrationIds.push(created.id);

    // Mock failed Slack auth.test
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'invalid_auth',
      }),
    } as Response);

    const updated = await updateIntegration(workspaceSlug, created.id, ownerId, {
      config: {
        botToken: 'xoxb-bad-token-222',
      },
    });

    expect(updated.status).toBe('error'); // Auto-tested and failed
    expect(updated.lastTestError).toBe('invalid_auth');
    expect(updated.lastTestedAt).toBeTruthy();
  });
});

describe('testIntegration', () => {
  it('should test integration and update status to active on success', async () => {
    const created = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Test Success',
      config: {
        botToken: 'xoxb-test-success-333',
        signingSecret: 'testsuccess33333',
      },
    });
    createdIntegrationIds.push(created.id);

    // Mock successful Slack auth.test
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        team: 'Success Team',
        team_id: 'T999',
        user: 'successbot',
        user_id: 'U999',
        bot_id: 'B999',
        url: 'https://success-team.slack.com/',
      }),
    } as Response);

    const result = await testIntegration(workspaceSlug, created.id, ownerId);

    expect(result.status).toBe('active');
    expect(result.lastTestedAt).toBeInstanceOf(Date);
    expect(result.info).toEqual({
      team: 'Success Team',
      teamId: 'T999',
      user: 'successbot',
      userId: 'U999',
      botId: 'B999',
      url: 'https://success-team.slack.com/',
    });
    expect(result.error).toBeUndefined();

    // Verify DB was updated
    const [dbRow] = await db
      .select()
      .from(integrations)
      .where(eq(integrations.id, created.id));

    expect(dbRow.status).toBe('active');
    expect(dbRow.lastTestedAt).toBeTruthy();
    expect(dbRow.lastTestError).toBeNull();

    // Verify slackMeta was persisted to config (plaintext, not encrypted)
    const dbConfig = dbRow.config as Record<string, unknown>;
    expect(dbConfig.slackMeta).toEqual({
      teamUrl: 'https://success-team.slack.com/',
      teamId: 'T999',
      team: 'Success Team',
    });
  });

  it('should expose slackMeta in masked API responses after successful test', async () => {
    const created = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'SlackMeta Mask Test',
      config: {
        botToken: 'xoxb-meta-mask-555',
        signingSecret: 'metamask555555555',
      },
    });
    createdIntegrationIds.push(created.id);

    // Mock successful Slack auth.test
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        team: 'Meta Team',
        team_id: 'TMETA',
        user: 'metabot',
        user_id: 'UMETA',
        bot_id: 'BMETA',
        url: 'https://meta-team.slack.com/',
      }),
    } as Response);

    await testIntegration(workspaceSlug, created.id, ownerId);

    // Masked response should include slackMeta (non-credential, plaintext, not masked)
    const masked = await getIntegration(workspaceSlug, created.id, ownerId);
    expect(masked.config.slackMeta).toEqual({
      teamUrl: 'https://meta-team.slack.com/',
      teamId: 'TMETA',
      team: 'Meta Team',
    });
    // Credentials should still be masked
    expect(masked.config.botToken).toMatch(/^••••••••/);
    expect(masked.config.signingSecret).toMatch(/^••••••••/);
  });

  it('should test integration and update status to error on failure', async () => {
    const created = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Test Failure',
      config: {
        botToken: 'xoxb-test-fail-444',
        signingSecret: 'testfail44444444',
      },
    });
    createdIntegrationIds.push(created.id);

    // Mock failed Slack auth.test
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: false,
        error: 'invalid_auth',
      }),
    } as Response);

    const result = await testIntegration(workspaceSlug, created.id, ownerId);

    expect(result.status).toBe('error');
    expect(result.lastTestedAt).toBeInstanceOf(Date);
    expect(result.error).toBe('invalid_auth');
    expect(result.info).toBeUndefined();

    // Verify DB was updated
    const [dbRow] = await db
      .select()
      .from(integrations)
      .where(eq(integrations.id, created.id));

    expect(dbRow.status).toBe('error');
    expect(dbRow.lastTestedAt).toBeTruthy();
    expect(dbRow.lastTestError).toBe('invalid_auth');

    // Verify slackMeta was NOT written on failure
    const dbConfig = dbRow.config as Record<string, unknown>;
    expect(dbConfig.slackMeta).toBeUndefined();
  });
});

describe('deleteIntegration', () => {
  it('should delete an integration', async () => {
    const created = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'To Delete',
      config: {
        botToken: 'xoxb-delete-555',
        signingSecret: 'delete5555555555',
      },
    });

    await deleteIntegration(workspaceSlug, created.id, ownerId);

    // Should throw NOT_FOUND when trying to get deleted integration
    await expect(
      getIntegration(workspaceSlug, created.id, ownerId)
    ).rejects.toThrow(ServiceError);

    // Verify it's gone from DB
    const rows = await db
      .select()
      .from(integrations)
      .where(eq(integrations.id, created.id));

    expect(rows.length).toBe(0);
  });

  it('should throw NOT_FOUND when deleting non-existent integration', async () => {
    await expect(
      deleteIntegration(workspaceSlug, 'non-existent', ownerId)
    ).rejects.toThrow(ServiceError);
  });
});

describe('Permission checks', () => {
  it('should allow member to read integrations', async () => {
    const created = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Permission Test',
      config: {
        botToken: 'xoxb-perm-666',
        signingSecret: 'perm666666666666',
      },
    });
    createdIntegrationIds.push(created.id);

    // Member can list
    const list = await listIntegrations(workspaceSlug, memberId);
    expect(list.some(i => i.id === created.id)).toBe(true);

    // Member can get
    const fetched = await getIntegration(workspaceSlug, created.id, memberId);
    expect(fetched.id).toBe(created.id);
  });

  it('should forbid member from managing integrations', async () => {
    // Member cannot create
    await expect(
      createIntegration(workspaceSlug, memberId, {
        type: 'slack',
        name: 'Forbidden Create',
        config: {
          botToken: 'xoxb-forbidden-777',
          signingSecret: 'forbidden7777777',
        },
      })
    ).rejects.toThrowError('Missing permission: integrations:manage');

    // Create one as owner for further tests
    const created = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Member Forbidden',
      config: {
        botToken: 'xoxb-member-888',
        signingSecret: 'member8888888888',
      },
    });
    createdIntegrationIds.push(created.id);

    // Member cannot update
    await expect(
      updateIntegration(workspaceSlug, created.id, memberId, {
        name: 'Should Fail',
      })
    ).rejects.toThrowError('Missing permission: integrations:manage');

    // Member cannot test
    await expect(
      testIntegration(workspaceSlug, created.id, memberId)
    ).rejects.toThrowError('Missing permission: integrations:manage');

    // Member cannot delete
    await expect(
      deleteIntegration(workspaceSlug, created.id, memberId)
    ).rejects.toThrowError('Missing permission: integrations:manage');
  });

  it('should allow manager to manage integrations', async () => {
    // Manager can create
    const created = await createIntegration(workspaceSlug, managerId, {
      type: 'slack',
      name: 'Manager Created',
      config: {
        botToken: 'xoxb-manager-999',
        signingSecret: 'manager999999999',
      },
    });
    createdIntegrationIds.push(created.id);

    expect(created.id).toBeTruthy();

    // Manager can update
    const updated = await updateIntegration(workspaceSlug, created.id, managerId, {
      name: 'Manager Updated',
    });
    expect(updated.name).toBe('Manager Updated');

    // Manager can test
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        team: 'Manager Team',
        team_id: 'TM',
        user: 'managerbot',
        user_id: 'UM',
        bot_id: 'BM',
        url: 'https://manager-team.slack.com/',
      }),
    } as Response);

    const testResult = await testIntegration(workspaceSlug, created.id, managerId);
    expect(testResult.status).toBe('active');

    // Manager can delete
    await deleteIntegration(workspaceSlug, created.id, managerId);

    // Verify deletion
    const rows = await db
      .select()
      .from(integrations)
      .where(eq(integrations.id, created.id));
    expect(rows.length).toBe(0);
  });

  it('should throw NOT_FOUND for non-member accessing any operation', async () => {
    const created = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Non-Member Test',
      config: {
        botToken: 'xoxb-nonmember-000',
        signingSecret: 'nonmember0000000',
      },
    });
    createdIntegrationIds.push(created.id);

    // Non-member gets NOT_FOUND for all operations
    await expect(
      listIntegrations(workspaceSlug, nonMemberId)
    ).rejects.toThrowError('Workspace not found');

    await expect(
      getIntegration(workspaceSlug, created.id, nonMemberId)
    ).rejects.toThrowError('Workspace not found');

    await expect(
      createIntegration(workspaceSlug, nonMemberId, {
        type: 'slack',
        name: 'Should Fail',
        config: {
          botToken: 'xoxb-fail',
          signingSecret: 'fail',
        },
      })
    ).rejects.toThrowError('Workspace not found');

    // Verify all throw NOT_FOUND specifically
    try {
      await listIntegrations(workspaceSlug, nonMemberId);
    } catch (error: unknown) {
      expectServiceError(error, 'NOT_FOUND');
    }
  });
});

describe('Multiple integrations', () => {
  it('should support multiple Slack integrations in same workspace', async () => {
    const slack1 = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Slack Team A',
      config: {
        botToken: 'xoxb-team-a-111',
        signingSecret: 'teama11111111111',
      },
    });
    createdIntegrationIds.push(slack1.id);

    const slack2 = await createIntegration(workspaceSlug, ownerId, {
      type: 'slack',
      name: 'Slack Team B',
      config: {
        botToken: 'xoxb-team-b-222',
        signingSecret: 'teamb22222222222',
      },
    });
    createdIntegrationIds.push(slack2.id);

    const list = await listIntegrations(workspaceSlug, ownerId);
    const slackIntegrations = list.filter(i => i.type === 'slack');

    expect(slackIntegrations.length).toBeGreaterThanOrEqual(2);
    expect(slackIntegrations.some(i => i.name === 'Slack Team A')).toBe(true);
    expect(slackIntegrations.some(i => i.name === 'Slack Team B')).toBe(true);
  });
});
