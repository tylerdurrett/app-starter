import { beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  vi.clearAllMocks();
  getLastActiveProjectMock.mockResolvedValue(null);
  listProjectsMock.mockResolvedValue([]);
  listWorkspacesMock.mockResolvedValue([]);
});

describe('resolveProject', () => {
  it('targets the nested workspace/project URL for the last-active project', async () => {
    getLastActiveProjectMock.mockResolvedValue(
      project({ slug: 'last-proj', workspaceSlug: 'last-ws' }) as never,
    );

    const target = await resolveProject();

    expect(target).toEqual({
      to: '/w/$workspaceSlug/p/$projectSlug',
      params: { workspaceSlug: 'last-ws', projectSlug: 'last-proj' },
    });
    // First-project and workspace fallbacks must not be consulted when last-active resolves.
    expect(listProjectsMock).not.toHaveBeenCalled();
    expect(listWorkspacesMock).not.toHaveBeenCalled();
  });

  it('targets the nested workspace/project URL for the first project when no last-active', async () => {
    listProjectsMock.mockResolvedValue([
      project({ slug: 'first-proj', workspaceSlug: 'first-ws', role: 'owner' }) as never,
    ]);

    const target = await resolveProject();

    expect(target).toEqual({
      to: '/w/$workspaceSlug/p/$projectSlug',
      params: { workspaceSlug: 'first-ws', projectSlug: 'first-proj' },
    });
    expect(listWorkspacesMock).not.toHaveBeenCalled();
  });

  it('falls back to the first workspace when the user has no projects', async () => {
    listWorkspacesMock.mockResolvedValue([
      { id: 'w1', name: 'Acme', slug: 'acme', role: 'owner' } as never,
    ]);

    const target = await resolveProject();

    expect(target).toEqual({ to: '/w/$workspaceSlug', params: { workspaceSlug: 'acme' } });
  });

  it('falls back to onboarding when the user has no projects or workspaces', async () => {
    const target = await resolveProject();

    expect(target).toEqual({ to: '/onboarding/create-workspace' });
  });
});
