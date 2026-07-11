import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  workspaceSchema,
  workspaceMemberSchema,
  workspaceInviteSchema,
} from '@repo/shared';

// Well-formed reference payloads matching the shared API contract.
const validWorkspace = {
  id: 'w1',
  name: 'Acme',
  slug: 'acme',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const validMember = {
  userId: 'u1',
  role: 'member',
  createdAt: '2026-01-01T00:00:00.000Z',
  name: 'Ada',
  email: 'ada@example.com',
};

const validInvite = {
  id: 'i1',
  email: 'ada@example.com',
  role: 'member',
  status: 'pending',
  expiresAt: '2026-01-08T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  invitedByName: 'Owner',
};

// A schema drift must fail loudly, never silently. Cover the top-level Workspace
// shape AND the invite/membership sub-shapes so a mismatch in either surfaces.
describe('workspace contract schemas', () => {
  it('accept the well-formed reference payloads', () => {
    expect(() => workspaceSchema.parse(validWorkspace)).not.toThrow();
    expect(() => workspaceMemberSchema.parse(validMember)).not.toThrow();
    expect(() => workspaceInviteSchema.parse(validInvite)).not.toThrow();
  });

  it('throws on a Workspace missing a required field', () => {
    const bad = { id: 'w1', name: 'Acme', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    expect(() => workspaceSchema.parse(bad)).toThrow();
  });

  it('throws on a WorkspaceMember with a renamed field', () => {
    const bad = { userId: 'u1', roles: 'member', createdAt: '2026-01-01T00:00:00.000Z', name: 'Ada', email: 'ada@example.com' };
    expect(() => workspaceMemberSchema.parse(bad)).toThrow();
  });

  it('throws on a WorkspaceMember with an out-of-range role', () => {
    expect(() => workspaceMemberSchema.parse({ ...validMember, role: 'superadmin' })).toThrow();
  });

  it('throws on a WorkspaceInvite missing invitedByName', () => {
    const bad = {
      id: 'i1',
      email: 'ada@example.com',
      role: 'member',
      status: 'pending',
      expiresAt: '2026-01-08T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(() => workspaceInviteSchema.parse(bad)).toThrow();
  });

  it('throws on a WorkspaceInvite with an out-of-range status', () => {
    expect(() => workspaceInviteSchema.parse({ ...validInvite, status: 'expired' })).toThrow();
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

  async function loadLibReturning(body: unknown) {
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
    return import('./workspaces');
  }

  it('rejects when the server returns a malformed WorkspaceMember', async () => {
    const { listWorkspaceMembers } = await loadLibReturning([{ ...validMember, role: 'superadmin' }]);
    await expect(listWorkspaceMembers('acme')).rejects.toThrow();
  });

  it('rejects when the server returns a malformed WorkspaceInvite', async () => {
    const badInvite = {
      id: 'i1',
      email: 'ada@example.com',
      role: 'member',
      status: 'pending',
      expiresAt: '2026-01-08T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { listWorkspaceInvites } = await loadLibReturning([badInvite]);
    await expect(listWorkspaceInvites('acme')).rejects.toThrow();
  });

  it('resolves when the server returns a well-formed WorkspaceWithRole', async () => {
    const { getWorkspace } = await loadLibReturning({ ...validWorkspace, role: 'owner' });
    await expect(getWorkspace('acme')).resolves.toMatchObject({ slug: 'acme', role: 'owner' });
  });
});
