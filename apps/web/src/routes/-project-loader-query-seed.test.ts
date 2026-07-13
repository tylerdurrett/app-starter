import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProject: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Outlet: () => null,
  notFound: vi.fn(),
  useNavigate: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(),
}));

vi.mock('@repo/ui', () => ({ Button: () => null }));

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
}));

vi.mock('../lib/projects', () => ({
  getProject: mocks.getProject,
  getLastActiveProject: vi.fn(),
  listProjects: vi.fn(),
  listProjectMembers: vi.fn(),
  listProjectInvites: vi.fn(),
}));

import { Route } from './_app.w.$workspaceSlug.p.$projectSlug';
import {
  lastActiveProjectQueryOptions,
  lastActiveProjectValidationQueryOptions,
  projectQueryOptions,
} from '../lib/project-queries';

type Loader = (input: {
  params: { workspaceSlug: string; projectSlug: string };
  context: { queryClient: { setQueryData: (key: readonly unknown[], data: unknown) => void } };
}) => Promise<unknown>;

describe('Project route loader Query seeds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('seeds detail, base last-active, and the exact loaded hint after the gate succeeds', async () => {
    const loaded = {
      id: 'project-b',
      name: 'Shared',
      slug: 'shared',
      workspaceId: 'workspace-id-b',
      workspaceSlug: 'workspace-b',
      workspaceName: 'Workspace B',
      role: 'owner' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    mocks.getProject.mockResolvedValue(loaded);
    const setQueryData = vi.fn();
    const loader = (Route as unknown as { options: { loader: Loader } }).options.loader;

    await expect(
      loader({
        params: { workspaceSlug: 'workspace-b', projectSlug: 'shared' },
        context: { queryClient: { setQueryData } },
      }),
    ).resolves.toEqual({ project: loaded });

    const hint = {
      workspaceSlug: 'workspace-b',
      projectSlug: 'shared',
      projectId: 'project-b',
    };
    expect(setQueryData.mock.calls).toEqual([
      [projectQueryOptions('workspace-b', 'shared').queryKey, loaded],
      [lastActiveProjectQueryOptions().queryKey, loaded],
      [lastActiveProjectValidationQueryOptions(hint).queryKey, loaded],
    ]);
  });
});
