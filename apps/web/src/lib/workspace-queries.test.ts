import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { queryKeys } from './query-keys';
import type { ProjectWithRole } from './projects';
import type { WorkspaceWithRole } from './workspaces';
import {
  workspaceProjectsQueryOptions,
  workspaceQueryOptions,
  workspacesQueryOptions,
} from './workspace-queries';

vi.mock('./workspaces', () => ({
  listWorkspaces: vi.fn().mockResolvedValue([{ id: 'workspace-1', slug: 'acme' }]),
  getWorkspace: vi.fn().mockResolvedValue({ id: 'workspace-1', slug: 'acme' }),
  listProjectsForWorkspace: vi.fn().mockResolvedValue([{ id: 'project-1', slug: 'web' }]),
}));

import {
  getWorkspace,
  listProjectsForWorkspace,
  listWorkspaces,
} from './workspaces';

afterEach(() => {
  vi.clearAllMocks();
});

describe('workspace query options', () => {
  it('wires the workspace list key to its argument-free fetcher', async () => {
    const options = workspacesQueryOptions();

    expect(options.queryKey).toEqual(queryKeys.workspaces());
    expectTypeOf<ReturnType<typeof options.queryFn>>().toEqualTypeOf<
      Promise<WorkspaceWithRole[]>
    >();
    await expect(options.queryFn()).resolves.toEqual([{ id: 'workspace-1', slug: 'acme' }]);
    expect(listWorkspaces).toHaveBeenCalledWith();
  });

  it('wires workspace detail to the exact slug', async () => {
    const options = workspaceQueryOptions('acme');

    expect(options.queryKey).toEqual(queryKeys.workspace('acme'));
    expectTypeOf<ReturnType<typeof options.queryFn>>().toEqualTypeOf<
      Promise<WorkspaceWithRole>
    >();
    await options.queryFn();
    expect(getWorkspace).toHaveBeenCalledWith('acme');
  });

  it('wires a workspace project list to the exact slug', async () => {
    const options = workspaceProjectsQueryOptions('acme');

    expect(options.queryKey).toEqual(queryKeys.projects('acme'));
    expectTypeOf<ReturnType<typeof options.queryFn>>().toEqualTypeOf<
      Promise<ProjectWithRole[]>
    >();
    await options.queryFn();
    expect(listProjectsForWorkspace).toHaveBeenCalledWith('acme');
  });
});
