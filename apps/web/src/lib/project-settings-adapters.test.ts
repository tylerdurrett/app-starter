import type { QueryClient } from '@tanstack/react-query';
import type { NavigateOptions } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from './query-keys';

vi.mock('./projects', () => ({
  getProject: vi.fn().mockResolvedValue({ name: 'Roadmap' }),
  updateProject: vi.fn().mockResolvedValue({ name: 'Renamed' }),
  deleteProject: vi.fn().mockResolvedValue(undefined),
  listProjectMembers: vi.fn().mockResolvedValue([]),
  removeProjectMember: vi.fn().mockResolvedValue(undefined),
  listProjectInvites: vi.fn().mockResolvedValue([]),
  createProjectInvite: vi.fn().mockResolvedValue({ inviteUrl: 'https://example.test/invite' }),
  revokeProjectInvite: vi.fn().mockResolvedValue(undefined),
}));

import { createProjectSettingsAdapters } from './project-settings-adapters';
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
import type { ProjectRole } from './permissions';

function setup(role: ProjectRole = 'owner') {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  const queryClient = { invalidateQueries } as unknown as QueryClient;
  const navigate = vi.fn(async (_options: NavigateOptions) => undefined);
  const adapters = createProjectSettingsAdapters({
    workspaceSlug: 'acme',
    projectSlug: 'roadmap',
    role,
    currentUserId: 'current-user',
    queryClient,
    navigate,
  });
  return { adapters, invalidateQueries, navigate };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('Project settings adapters', () => {
  it('binds the live Project detail and rename to workspace-scoped APIs and keys', async () => {
    const { adapters, invalidateQueries } = setup();

    expect(adapters.name.queryOptions.queryKey).toEqual(queryKeys.project('acme', 'roadmap'));
    const queryFn = adapters.name.queryOptions.queryFn;
    if (typeof queryFn !== 'function') throw new Error('Expected a Project query function');
    await queryFn({} as never);
    expect(getProject).toHaveBeenCalledWith('acme', 'roadmap');

    await adapters.name.updateName('Quarterly roadmap');
    expect(updateProject).toHaveBeenCalledWith('acme', 'roadmap', {
      name: 'Quarterly roadmap',
    });

    await adapters.name.refresh({ invalidateQueries } as unknown as QueryClient);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.project('acme', 'roadmap'),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projects('acme'),
    });
  });

  it('binds Membership reads/removal and the current session without an owner-target veto', async () => {
    const { adapters } = setup('manager');
    const owner = {
      userId: 'project-owner',
      name: 'Owner',
      email: 'owner@example.test',
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as const;

    expect(adapters.currentUserId).toBe('current-user');
    expect(adapters.membership.queryKey).toEqual(queryKeys.projectMembers('acme', 'roadmap'));
    await adapters.membership.listMembers();
    expect(listProjectMembers).toHaveBeenCalledWith('acme', 'roadmap');
    expect(adapters.membership.canRemove(owner)).toBe(true);

    await adapters.membership.removeMember(owner.userId);
    expect(removeProjectMember).toHaveBeenCalledWith('acme', 'roadmap', 'project-owner');
  });

  it('keeps the signed-in Project role as the permission source, including Workspace override roles', () => {
    const effectiveOwner = setup('owner').adapters;
    const manager = setup('manager').adapters;
    const member = setup('member').adapters;
    const ownerTarget = {
      userId: 'owner-user',
      name: 'Owner',
      email: 'owner@example.test',
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    } as const;

    expect(effectiveOwner.name.canEdit).toBe(true);
    expect(effectiveOwner.canDelete).toBe(true);
    expect(effectiveOwner.membership.canRemove(ownerTarget)).toBe(true);
    expect(manager.name.canEdit).toBe(true);
    expect(manager.canDelete).toBe(false);
    expect(manager.membership.canRemove(ownerTarget)).toBe(true);
    expect(member.name.canEdit).toBe(false);
    expect(member.canDelete).toBe(false);
    expect(member.membership.canList).toBe(true);
    expect(member.membership.canRemove(ownerTarget)).toBe(false);
    expect(member.invites.canList).toBe(true);
    expect(member.invites.canCreate).toBe(false);
    expect(member.invites.canRevoke).toBe(false);
  });

  it('binds Invite operations and refresh to the containing Workspace and Project', async () => {
    const { adapters, invalidateQueries } = setup();

    expect(adapters.invites.queryKey).toEqual(queryKeys.projectInvites('acme', 'roadmap'));
    await adapters.invites.listInvites();
    expect(listProjectInvites).toHaveBeenCalledWith('acme', 'roadmap');

    await adapters.invites.createInvite('new@example.test', 'manager');
    expect(createProjectInvite).toHaveBeenCalledWith(
      'acme',
      'roadmap',
      'new@example.test',
      'manager',
    );
    await adapters.invites.revokeInvite('invite-1');
    expect(revokeProjectInvite).toHaveBeenCalledWith('acme', 'roadmap', 'invite-1');

    await adapters.invites.refreshInvites();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projectInvites('acme', 'roadmap'),
    });
  });

  it('uses Project-specific delete copy, API/key scope, and the exact containing-Workspace destination', async () => {
    const { adapters, invalidateQueries, navigate } = setup();

    expect(adapters.deletion.queryOptions.queryKey).toEqual(queryKeys.project('acme', 'roadmap'));
    expect(adapters.deletion.title).toBe('Delete this project');
    expect(adapters.deletion.revealButton).toBe('Delete project');
    expect(adapters.deletion.errorFallback).toBe('Failed to delete project');

    await adapters.deletion.deleteResource('Delete Roadmap');
    expect(deleteProject).toHaveBeenCalledWith('acme', 'roadmap', 'Delete Roadmap');

    await adapters.deletion.refreshAfterDelete({ invalidateQueries } as unknown as QueryClient);
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projects('acme'),
    });

    await adapters.deletion.onDeleted();
    expect(navigate).toHaveBeenCalledWith({
      to: '/w/$workspaceSlug',
      params: { workspaceSlug: 'acme' },
    });
  });

  it('keeps otherwise-identical Project adapters isolated by Workspace slug', () => {
    const first = setup().adapters;
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const second = createProjectSettingsAdapters({
      workspaceSlug: 'other-workspace',
      projectSlug: 'roadmap',
      role: 'owner',
      queryClient: { invalidateQueries } as unknown as QueryClient,
      navigate: vi.fn(async (_options: NavigateOptions) => undefined),
    });

    expect(first.name.queryOptions.queryKey).not.toEqual(second.name.queryOptions.queryKey);
    expect(first.membership.queryKey).not.toEqual(second.membership.queryKey);
    expect(first.invites.queryKey).not.toEqual(second.invites.queryKey);
  });
});
