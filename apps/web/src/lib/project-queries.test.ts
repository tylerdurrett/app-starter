import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from './query-keys';
import { projectMembersQueryOptions, projectInvitesQueryOptions } from './project-queries';

// The projects lib fetchers are the network boundary; mock them so these tests
// stay pure functions (apps/web has no jsdom/renderHook infra). We assert two
// things per factory: the returned queryKey is the exact shared tuple, and the
// queryFn delegates to the right fetcher with the right (workspaceSlug, slug).
vi.mock('./projects', () => ({
  listProjectMembers: vi.fn().mockResolvedValue([{ userId: 'u1' }]),
  listProjectInvites: vi.fn().mockResolvedValue([{ id: 'i1' }]),
}));

import { listProjectMembers, listProjectInvites } from './projects';

afterEach(() => {
  vi.clearAllMocks();
});

describe('projectMembersQueryOptions', () => {
  it('uses the shared projectMembers query key', () => {
    expect(projectMembersQueryOptions('acme', 'web').queryKey).toEqual(
      queryKeys.projectMembers('acme', 'web'),
    );
  });

  it('queryFn calls listProjectMembers with the workspace and project slug', async () => {
    const result = await projectMembersQueryOptions('acme', 'web').queryFn();
    expect(listProjectMembers).toHaveBeenCalledWith('acme', 'web');
    expect(result).toEqual([{ userId: 'u1' }]);
  });
});

describe('projectInvitesQueryOptions', () => {
  it('uses the shared projectInvites query key', () => {
    expect(projectInvitesQueryOptions('acme', 'web').queryKey).toEqual(
      queryKeys.projectInvites('acme', 'web'),
    );
  });

  it('queryFn calls listProjectInvites with the workspace and project slug', async () => {
    const result = await projectInvitesQueryOptions('acme', 'web').queryFn();
    expect(listProjectInvites).toHaveBeenCalledWith('acme', 'web');
    expect(result).toEqual([{ id: 'i1' }]);
  });
});
