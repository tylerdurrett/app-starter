import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api';
import {
  createProjectInvite,
  deleteProject,
  getProject,
  listProjectInvites,
  listProjectMembers,
  removeProjectMember,
  revokeProjectInvite,
  updateProject,
} from './projects';

vi.mock('./api', () => ({
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

const WS = 'acme';
const SLUG = 'proj';

/** The first call's [path, options] tuple, asserting apiFetch was called once. */
function firstCall(): [string, RequestInit?] {
  const call = apiFetchMock.mock.calls[0];
  if (!call) throw new Error('apiFetch was not called');
  return call;
}

/** The URL (first arg) apiFetch was called with. */
function calledPath(): string {
  return firstCall()[0];
}

/** The RequestInit options (second arg) apiFetch was called with. */
function calledOptions(): RequestInit | undefined {
  return firstCall()[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockResolvedValue(undefined as never);
});

describe('workspace-scoped project client helpers', () => {
  it('getProject targets /api/workspaces/:ws/projects/:slug', async () => {
    await getProject(WS, SLUG);
    expect(calledPath()).toBe('/api/workspaces/acme/projects/proj');
  });

  it('updateProject PATCHes /api/workspaces/:ws/projects/:slug', async () => {
    await updateProject(WS, SLUG, { name: 'New' });
    expect(calledPath()).toBe('/api/workspaces/acme/projects/proj');
    expect(calledOptions()).toMatchObject({ method: 'PATCH' });
  });

  it('deleteProject DELETEs /api/workspaces/:ws/projects/:slug', async () => {
    await deleteProject(WS, SLUG, 'proj');
    expect(calledPath()).toBe('/api/workspaces/acme/projects/proj');
    expect(calledOptions()).toMatchObject({ method: 'DELETE' });
  });

  it('listProjectMembers targets the workspace-scoped members path', async () => {
    await listProjectMembers(WS, SLUG);
    expect(calledPath()).toBe('/api/workspaces/acme/projects/proj/members');
  });

  it('removeProjectMember targets the workspace-scoped member path', async () => {
    await removeProjectMember(WS, SLUG, 'user-1');
    expect(calledPath()).toBe('/api/workspaces/acme/projects/proj/members/user-1');
    expect(calledOptions()).toMatchObject({ method: 'DELETE' });
  });

  it('listProjectInvites targets the workspace-scoped invites path', async () => {
    await listProjectInvites(WS, SLUG);
    expect(calledPath()).toBe('/api/workspaces/acme/projects/proj/invites');
  });

  it('createProjectInvite POSTs the workspace-scoped invites path', async () => {
    apiFetchMock.mockResolvedValue({ invite: {}, inviteUrl: '' } as never);
    await createProjectInvite(WS, SLUG, 'a@b.com', 'member');
    expect(calledPath()).toBe('/api/workspaces/acme/projects/proj/invites');
    expect(calledOptions()).toMatchObject({ method: 'POST' });
  });

  it('revokeProjectInvite POSTs the workspace-scoped invite revoke path', async () => {
    await revokeProjectInvite(WS, SLUG, 'invite-1');
    expect(calledPath()).toBe('/api/workspaces/acme/projects/proj/invites/invite-1/revoke');
    expect(calledOptions()).toMatchObject({ method: 'POST' });
  });
});
