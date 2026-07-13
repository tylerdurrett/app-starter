import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuthenticatedClientState } from './authenticated-client-state';
import { readActiveContext, writeActiveContext } from './active-workspace';
import { accessibleProjectsQueryOptions, lastActiveProjectQueryOptions } from './project-queries';
import { resolveProject } from './project-resolver';
import { getLastActiveProject, listProjects } from './projects';
import { listWorkspaces } from './workspaces';

vi.mock('./projects', () => ({
  getLastActiveProject: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock('./workspaces', () => ({
  listWorkspaces: vi.fn(),
}));

const getLastActiveProjectMock = vi.mocked(getLastActiveProject);
const listProjectsMock = vi.mocked(listProjects);
const listWorkspacesMock = vi.mocked(listWorkspaces);

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Proj',
    slug: 'proj',
    workspaceId: 'w1',
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getLastActiveProjectMock.mockResolvedValue(null);
  listProjectsMock.mockResolvedValue([]);
  listWorkspacesMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveProject', () => {
  it.each([
    {
      state: 'last-active project',
      lastActive: project({ slug: 'last-proj', workspaceSlug: 'last-ws' }),
      projects: [],
      workspaces: [],
      calls: ['last-active'],
      target: {
        to: '/w/$workspaceSlug/p/$projectSlug',
        params: { workspaceSlug: 'last-ws', projectSlug: 'last-proj' },
      },
    },
    {
      state: 'first accessible project',
      lastActive: null,
      projects: [project({ slug: 'first-proj', workspaceSlug: 'first-ws', role: 'owner' })],
      workspaces: [],
      calls: ['last-active', 'projects'],
      target: {
        to: '/w/$workspaceSlug/p/$projectSlug',
        params: { workspaceSlug: 'first-ws', projectSlug: 'first-proj' },
      },
    },
    {
      state: 'first workspace without a project',
      lastActive: null,
      projects: [],
      workspaces: [{ id: 'w1', name: 'Acme', slug: 'acme', role: 'owner' }],
      calls: ['last-active', 'projects', 'workspaces'],
      target: {
        to: '/w/$workspaceSlug',
        params: { workspaceSlug: 'acme' },
      },
    },
    {
      state: 'zero tenancy',
      lastActive: null,
      projects: [],
      workspaces: [],
      calls: ['last-active', 'projects', 'workspaces'],
      target: { to: '/onboarding/create-workspace' },
    },
  ] as const)(
    'preserves the ADR-0012 sequential fallback for $state',
    async ({ lastActive, projects, workspaces, calls: expectedCalls, target }) => {
      const calls: string[] = [];
      getLastActiveProjectMock.mockImplementation(async () => {
        calls.push('last-active');
        return lastActive as never;
      });
      listProjectsMock.mockImplementation(async () => {
        calls.push('projects');
        return [...projects] as never;
      });
      listWorkspacesMock.mockImplementation(async () => {
        calls.push('workspaces');
        return [...workspaces] as never;
      });

      await expect(resolveProject(createQueryClient())).resolves.toEqual(target);
      expect(calls).toEqual(expectedCalls);
    },
  );

  it('reuses fresh QueryClient data during the same session', async () => {
    const queryClient = createQueryClient();
    const cached = project({ id: 'cached', slug: 'cached-project', workspaceSlug: 'cached-ws' });
    queryClient.setQueryData(lastActiveProjectQueryOptions().queryKey, cached);

    const target = await resolveProject(queryClient);

    expect(target.params).toEqual({ workspaceSlug: 'cached-ws', projectSlug: 'cached-project' });
    expect(getLastActiveProjectMock).not.toHaveBeenCalled();
    expect(listProjectsMock).not.toHaveBeenCalled();
  });

  it('clears user A state before resolving user B from the network', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });
    const queryClient = createQueryClient();
    const userA = project({ id: 'user-a-project', slug: 'a-project', workspaceSlug: 'a-workspace' });
    queryClient.setQueryData(lastActiveProjectQueryOptions().queryKey, userA);
    queryClient.setQueryData(accessibleProjectsQueryOptions().queryKey, [userA]);
    writeActiveContext({
      workspaceSlug: 'a-workspace',
      projectSlug: 'a-project',
      projectId: 'user-a-project',
    });
    getLastActiveProjectMock.mockResolvedValue(
      project({ id: 'user-b-project', slug: 'b-project', workspaceSlug: 'b-workspace' }) as never,
    );

    await clearAuthenticatedClientState(queryClient);
    const target = await resolveProject(queryClient);

    expect(readActiveContext()).toBeNull();
    expect(target.params).toEqual({ workspaceSlug: 'b-workspace', projectSlug: 'b-project' });
    expect(getLastActiveProjectMock).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(accessibleProjectsQueryOptions().queryKey)).toBeUndefined();
    expect(queryClient.getQueryData(lastActiveProjectQueryOptions().queryKey)).toMatchObject({
      id: 'user-b-project',
    });
    expect(queryClient.getQueryCache().findAll()).toHaveLength(1);
  });
});
