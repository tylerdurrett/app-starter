import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './query-keys';
import {
  accessibleProjectsQueryOptions,
  lastActiveProjectQueryOptions,
  lastActiveProjectValidationQueryOptions,
  projectQueryOptions,
  projectMembersQueryOptions,
  projectInvitesQueryOptions,
} from './project-queries';

// The projects lib fetchers are the network boundary; mock them so these tests
// stay pure functions (apps/web has no jsdom/renderHook infra). We assert two
// things per factory: the returned queryKey is the exact shared tuple, and the
// queryFn delegates to the right fetcher with the right (workspaceSlug, slug).
vi.mock('./projects', () => ({
  getProject: vi.fn().mockResolvedValue({ name: 'Web', slug: 'web' }),
  getLastActiveProject: vi.fn().mockResolvedValue({ id: 'project-1', slug: 'web' }),
  listProjects: vi.fn().mockResolvedValue([{ id: 'project-1', slug: 'web' }]),
  listProjectMembers: vi.fn().mockResolvedValue([{ userId: 'u1' }]),
  listProjectInvites: vi.fn().mockResolvedValue([{ id: 'i1' }]),
}));

import {
  getProject,
  getLastActiveProject,
  listProjects,
  listProjectMembers,
  listProjectInvites,
} from './projects';

afterEach(() => {
  vi.clearAllMocks();
});

describe('navigation project query options', () => {
  it('uses a distinct global accessible-project key and delegates without arguments', async () => {
    const options = accessibleProjectsQueryOptions();

    expect(options.queryKey).toEqual(queryKeys.accessibleProjects());
    await expect(options.queryFn()).resolves.toEqual([{ id: 'project-1', slug: 'web' }]);
    expect(listProjects).toHaveBeenCalledWith();
  });

  it('provides base and hint-scoped last-active reads through the same fetcher', async () => {
    const hint = { workspaceSlug: 'acme', projectSlug: 'web', projectId: 'project-1' };
    const base = lastActiveProjectQueryOptions();
    const validation = lastActiveProjectValidationQueryOptions(hint);

    expect(base.queryKey).toEqual(queryKeys.lastActiveProject());
    expect(validation.queryKey).toEqual(queryKeys.lastActiveProjectValidation(hint));
    await Promise.all([base.queryFn(), validation.queryFn()]);
    expect(getLastActiveProject).toHaveBeenCalledTimes(2);
    expect(getLastActiveProject).toHaveBeenNthCalledWith(1);
    expect(getLastActiveProject).toHaveBeenNthCalledWith(2);
  });

  it('keeps base and A/B validation verdicts in independent cache entries', () => {
    const client = new QueryClient();
    const hintA = { workspaceSlug: 'acme', projectSlug: 'web', projectId: 'project-a' };
    const hintB = { workspaceSlug: 'other', projectSlug: 'web', projectId: 'project-b' };

    client.setQueryData(queryKeys.lastActiveProject(), 'base');
    client.setQueryData(queryKeys.lastActiveProjectValidation(hintA), 'A');
    client.setQueryData(queryKeys.lastActiveProjectValidation(hintB), 'B');

    expect(client.getQueryData(queryKeys.lastActiveProject())).toBe('base');
    expect(client.getQueryData(queryKeys.lastActiveProjectValidation(hintA))).toBe('A');
    expect(client.getQueryData(queryKeys.lastActiveProjectValidation(hintB))).toBe('B');
    client.clear();
  });

  it('lets QueryClient deduplicate concurrent consumers of shared options', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(listProjects).mockImplementationOnce(async () => {
      await gate;
      return [];
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const first = client.fetchQuery(accessibleProjectsQueryOptions());
    const second = client.fetchQuery(accessibleProjectsQueryOptions());

    expect(listProjects).toHaveBeenCalledTimes(1);
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    client.clear();
  });
});

describe('projectQueryOptions', () => {
  it('uses the shared project detail query key', () => {
    expect(projectQueryOptions('acme', 'web').queryKey).toEqual(queryKeys.project('acme', 'web'));
  });

  it('queryFn calls getProject with the workspace and project slug', async () => {
    const result = await projectQueryOptions('acme', 'web').queryFn();
    expect(getProject).toHaveBeenCalledWith('acme', 'web');
    expect(result).toEqual({ name: 'Web', slug: 'web' });
  });
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
