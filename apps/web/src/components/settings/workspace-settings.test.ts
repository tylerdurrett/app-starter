import { QueryClient } from '@tanstack/react-query';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../lib/query-keys';

type Mod = typeof import('./workspace-settings');
let createWorkspaceSettingsAdapters: Mod['createWorkspaceSettingsAdapters'];

beforeAll(async () => {
  vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
  ({ createWorkspaceSettingsAdapters } = await import('./workspace-settings'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function setup(role: 'owner' | 'manager' | 'member' = 'owner') {
  const queryClient = new QueryClient();
  const invalidateQueries = vi
    .spyOn(queryClient, 'invalidateQueries')
    .mockResolvedValue(undefined);
  const navigate = vi.fn().mockResolvedValue(undefined);
  const destination = {
    to: '/w/$workspaceSlug/p/$projectSlug',
    params: { workspaceSlug: 'next-workspace', projectSlug: 'next-project' },
  };
  const dependencies = {
    getWorkspace: vi.fn(),
    updateWorkspace: vi.fn().mockResolvedValue(undefined),
    listMembers: vi.fn().mockResolvedValue([]),
    removeMember: vi.fn().mockResolvedValue(undefined),
    listInvites: vi.fn().mockResolvedValue([]),
    createInvite: vi.fn().mockResolvedValue({ inviteUrl: 'https://example.test/invite' }),
    revokeInvite: vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: vi.fn().mockResolvedValue(undefined),
    resolveDestination: vi.fn().mockResolvedValue(destination),
  };
  const adapters = createWorkspaceSettingsAdapters({
    workspaceSlug: 'acme',
    role,
    queryClient,
    navigate,
    dependencies,
  });

  return { adapters, dependencies, queryClient, invalidateQueries, navigate, destination };
}

describe('Workspace settings adapters', () => {
  it('uses Workspace-scoped Query keys and existing API argument shapes', async () => {
    const { adapters, dependencies } = setup();

    expect(adapters.name.queryOptions.queryKey).toEqual(queryKeys.workspace('acme'));
    expect(adapters.membership.queryKey).toEqual(queryKeys.workspaceMembers('acme'));
    expect(adapters.invites.queryKey).toEqual(queryKeys.workspaceInvites('acme'));
    expect(adapters.deletion?.queryOptions.queryKey).toEqual(queryKeys.workspace('acme'));

    await adapters.name.updateName('Renamed workspace');
    await adapters.membership.listMembers();
    await adapters.membership.removeMember('user-2');
    await adapters.invites.listInvites();
    await adapters.invites.createInvite('person@example.com', 'manager');
    await adapters.invites.revokeInvite('invite-1');
    await adapters.deletion?.deleteResource('Delete Acme');

    expect(dependencies.updateWorkspace).toHaveBeenCalledWith('acme', 'Renamed workspace');
    expect(dependencies.listMembers).toHaveBeenCalledWith('acme');
    expect(dependencies.removeMember).toHaveBeenCalledWith('acme', 'user-2');
    expect(dependencies.listInvites).toHaveBeenCalledWith('acme');
    expect(dependencies.createInvite).toHaveBeenCalledWith(
      'acme',
      'person@example.com',
      'manager',
    );
    expect(dependencies.revokeInvite).toHaveBeenCalledWith('acme', 'invite-1');
    expect(dependencies.deleteWorkspace).toHaveBeenCalledWith('acme', 'Delete Acme');
  });

  it('refreshes both detail and list observers after rename', async () => {
    const { adapters, queryClient, invalidateQueries } = setup();

    await adapters.name.refresh(queryClient);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.workspace('acme') });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.workspaces() });
  });

  it('keeps each Workspace capability explicit across the permission matrix', () => {
    const owner = setup('owner').adapters;
    const manager = setup('manager').adapters;
    const member = setup('member').adapters;

    expect(owner.name.canEdit).toBe(true);
    expect(owner.membership.canList).toBe(true);
    expect(owner.invites).toMatchObject({ canList: true, canCreate: true, canRevoke: true });
    expect(owner.deletion).toBeDefined();

    expect(manager.name.canEdit).toBe(true);
    expect(manager.membership.canList).toBe(true);
    expect(manager.invites).toMatchObject({ canList: true, canCreate: true, canRevoke: true });
    expect(manager.deletion).toBeUndefined();

    expect(member.name.canEdit).toBe(false);
    expect(member.membership.canList).toBe(true);
    expect(member.invites).toMatchObject({ canList: true, canCreate: false, canRevoke: false });
    expect(member.deletion).toBeUndefined();
  });

  it('prevents managers from removing an owner while owners can remove others', () => {
    const ownerMember = {
      userId: 'owner-1',
      name: 'Owner',
      email: 'owner@example.com',
      role: 'owner' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const regularMember = { ...ownerMember, userId: 'member-1', role: 'member' as const };

    expect(setup('manager').adapters.membership.canRemove(ownerMember)).toBe(false);
    expect(setup('manager').adapters.membership.canRemove(regularMember)).toBe(true);
    expect(setup('owner').adapters.membership.canRemove(ownerMember)).toBe(true);
    expect(setup('owner').adapters.membership.canRemove(regularMember)).toBe(true);
    expect(setup('member').adapters.membership.canRemove(regularMember)).toBe(false);
  });

  it('invalidates the Workspace list, resolves the global fallback, then navigates', async () => {
    const {
      adapters,
      dependencies,
      queryClient,
      invalidateQueries,
      navigate,
      destination,
    } = setup();

    await adapters.deletion?.refreshAfterDelete(queryClient);
    await adapters.deletion?.onDeleted();

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.workspaces() });
    expect(dependencies.resolveDestination).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(destination);
  });

  it('scopes otherwise identical adapters to their Workspace slug', () => {
    const first = setup().adapters;
    const queryClient = new QueryClient();
    const second = createWorkspaceSettingsAdapters({
      workspaceSlug: 'other',
      role: 'owner',
      queryClient,
      navigate: vi.fn(),
    });

    expect(first.name.queryOptions.queryKey).not.toEqual(second.name.queryOptions.queryKey);
    expect(first.membership.queryKey).not.toEqual(second.membership.queryKey);
    expect(first.invites.queryKey).not.toEqual(second.invites.queryKey);
  });
});
