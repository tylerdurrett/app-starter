import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  projectSchema,
  projectMemberSchema,
  projectInviteSchema,
} from '@repo/shared';

// Well-formed reference payloads matching the shared API contract.
const validProject = {
  id: 'p1',
  name: 'Apollo',
  slug: 'apollo',
  workspaceId: 'w1',
  workspaceSlug: 'acme',
  workspaceName: 'Acme',
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

// A schema drift must fail loudly, never silently. Cover the top-level Project
// shape AND the invite/membership sub-shapes so a mismatch in either surfaces.
describe('project contract schemas', () => {
  it('accept the well-formed reference payloads', () => {
    expect(() => projectSchema.parse(validProject)).not.toThrow();
    expect(() => projectMemberSchema.parse(validMember)).not.toThrow();
    expect(() => projectInviteSchema.parse(validInvite)).not.toThrow();
  });

  it('throws on a Project missing workspace context', () => {
    const bad = {
      id: 'p1',
      name: 'Apollo',
      slug: 'apollo',
      workspaceId: 'w1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(() => projectSchema.parse(bad)).toThrow();
  });

  it('throws on a ProjectMember with a renamed field', () => {
    const bad = { userId: 'u1', roles: 'member', createdAt: '2026-01-01T00:00:00.000Z', name: 'Ada', email: 'ada@example.com' };
    expect(() => projectMemberSchema.parse(bad)).toThrow();
  });

  it('throws on a ProjectMember with an out-of-range role', () => {
    expect(() => projectMemberSchema.parse({ ...validMember, role: 'superadmin' })).toThrow();
  });

  it('throws on a ProjectInvite missing invitedByName', () => {
    const bad = {
      id: 'i1',
      email: 'ada@example.com',
      role: 'member',
      status: 'pending',
      expiresAt: '2026-01-08T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(() => projectInviteSchema.parse(bad)).toThrow();
  });

  it('throws on a ProjectInvite with an out-of-range status', () => {
    expect(() => projectInviteSchema.parse({ ...validInvite, status: 'expired' })).toThrow();
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
    return import('./projects');
  }

  it('rejects when the server returns a malformed ProjectMember', async () => {
    const { listProjectMembers } = await loadLibReturning([{ ...validMember, role: 'superadmin' }]);
    await expect(listProjectMembers('acme', 'apollo')).rejects.toThrow();
  });

  it('rejects when the server returns a malformed ProjectInvite', async () => {
    const badInvite = {
      id: 'i1',
      email: 'ada@example.com',
      role: 'member',
      status: 'pending',
      expiresAt: '2026-01-08T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const { listProjectInvites } = await loadLibReturning([badInvite]);
    await expect(listProjectInvites('acme', 'apollo')).rejects.toThrow();
  });

  it('rejects when the server omits project workspace context', async () => {
    const { getProject } = await loadLibReturning({ ...validProject, workspaceSlug: undefined, role: 'owner' });
    await expect(getProject('acme', 'apollo')).rejects.toThrow();
  });

  it('resolves when the server returns a well-formed ProjectWithRole', async () => {
    const { getProject } = await loadLibReturning({ ...validProject, role: 'owner' });
    await expect(getProject('acme', 'apollo')).resolves.toMatchObject({ slug: 'apollo', role: 'owner' });
  });

  it('resolves null for a nullable last-active project', async () => {
    const { getLastActiveProject } = await loadLibReturning(null);
    await expect(getLastActiveProject()).resolves.toBeNull();
  });

  // Guard the request URL each resource function builds — a mistyped route
  // template in projects.ts (wrong path, missing segment) must fail here even
  // though the response body still parses. apiFetch prefixes SERVER_URL, so the
  // captured argument is the full `http://test.local` + path string.
  it('GETs the correct project route template', async () => {
    const { getProject } = await loadLibReturning({ ...validProject, role: 'owner' });
    await getProject('acme', 'apollo');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://test.local/api/workspaces/acme/projects/apollo');
  });

  it('PATCHes the correct project route template on update', async () => {
    const { updateProject } = await loadLibReturning(validProject);
    await updateProject('acme', 'apollo', { name: 'Renamed' });
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://test.local/api/workspaces/acme/projects/apollo');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBe('PATCH');
  });

  it('DELETEs the correct project route template', async () => {
    const { deleteProject } = await loadLibReturning(null);
    await deleteProject('acme', 'apollo', 'apollo');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://test.local/api/workspaces/acme/projects/apollo');
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('lists members from the correct project route template', async () => {
    const { listProjectMembers } = await loadLibReturning([validMember]);
    await listProjectMembers('acme', 'apollo');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://test.local/api/workspaces/acme/projects/apollo/members');
  });

  it('lists invites from the correct project route template', async () => {
    const { listProjectInvites } = await loadLibReturning([validInvite]);
    await listProjectInvites('acme', 'apollo');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('http://test.local/api/workspaces/acme/projects/apollo/invites');
  });
});
