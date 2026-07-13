import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectWithRole } from '../lib/projects';

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  listProjectsForWorkspace: vi.fn(),
}));

vi.mock('../lib/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/projects')>()),
  createProject: mocks.createProject,
}));

vi.mock('../lib/workspaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/workspaces')>()),
  listProjectsForWorkspace: mocks.listProjectsForWorkspace,
}));

import { workspaceProjectsQueryOptions } from '../lib/workspace-queries';
import { queryKeys } from '../lib/query-keys';
import { CreateProjectModal } from './create-project-modal';

const createdProject: Project = {
  id: 'project-new',
  workspaceId: 'workspace-acme',
  workspaceSlug: 'acme',
  workspaceName: 'Acme',
  slug: 'new-project',
  name: 'New project',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function projectWithRole(project: Project): ProjectWithRole {
  return { ...project, role: 'owner' };
}

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function ProjectObserver({ workspaceSlug, label }: { workspaceSlug: string; label: string }) {
  const query = useQuery(workspaceProjectsQueryOptions(workspaceSlug));
  return (
    <div data-testid={label}>
      {query.data?.map((project) => project.name).join(', ') ?? 'Loading'}
    </div>
  );
}

function ModalHost({ onCreated }: { onCreated: (project: Project) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <CreateProjectModal
      workspaceSlug="acme"
      open={open}
      onOpenChange={setOpen}
      onCreated={onCreated}
    />
  );
}

function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('CreateProjectModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates the exact workspace list once and refreshes every observer before closing', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const existingProject = projectWithRole({
      ...createdProject,
      id: 'project-existing',
      slug: 'existing',
      name: 'Existing project',
    });
    const refreshedProjects = [existingProject, projectWithRole(createdProject)];

    mocks.createProject.mockResolvedValue(createdProject);
    mocks.listProjectsForWorkspace.mockImplementation(async (workspaceSlug: string) => {
      if (workspaceSlug === 'beta') return [];
      const acmeCalls = mocks.listProjectsForWorkspace.mock.calls.filter(
        ([slug]) => slug === 'acme',
      ).length;
      return acmeCalls === 1 ? [existingProject] : refreshedProjects;
    });

    const client = createClient();
    render(
      <Providers client={client}>
        <ProjectObserver workspaceSlug="acme" label="home-projects" />
        <ProjectObserver workspaceSlug="acme" label="switcher-projects" />
        <ProjectObserver workspaceSlug="beta" label="other-workspace-projects" />
        <ModalHost onCreated={onCreated} />
      </Providers>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('home-projects')).toHaveTextContent('Existing project');
      expect(screen.getByTestId('switcher-projects')).toHaveTextContent('Existing project');
    });

    await user.type(screen.getByLabelText('Name'), '  New project  ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByTestId('home-projects')).toHaveTextContent(
        'Existing project, New project',
      );
      expect(screen.getByTestId('switcher-projects')).toHaveTextContent(
        'Existing project, New project',
      );
    });
    expect(mocks.createProject).toHaveBeenCalledOnce();
    expect(mocks.createProject).toHaveBeenCalledWith('acme', 'New project');
    expect(
      mocks.listProjectsForWorkspace.mock.calls.filter(([slug]) => slug === 'acme'),
    ).toHaveLength(2);
    expect(
      mocks.listProjectsForWorkspace.mock.calls.filter(([slug]) => slug === 'beta'),
    ).toHaveLength(1);
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledWith(createdProject);
    expect(client.getQueryData(queryKeys.project('acme', 'new-project'))).toBeUndefined();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the form open after failure and retries without an extra list request', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    mocks.listProjectsForWorkspace
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([projectWithRole(createdProject)]);
    mocks.createProject
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(createdProject);

    const client = createClient();
    render(
      <Providers client={client}>
        <ProjectObserver workspaceSlug="acme" label="projects" />
        <ModalHost onCreated={onCreated} />
      </Providers>,
    );

    await waitFor(() => expect(mocks.listProjectsForWorkspace).toHaveBeenCalledOnce());
    await user.type(screen.getByLabelText('Name'), 'New project');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to create project');
    expect(screen.getByLabelText('Name')).toHaveValue('New project');
    expect(mocks.listProjectsForWorkspace).toHaveBeenCalledOnce();
    expect(onCreated).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(mocks.createProject).toHaveBeenCalledTimes(2);
    expect(mocks.listProjectsForWorkspace).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('projects')).toHaveTextContent('New project');
    expect(client.getQueryData(queryKeys.project('acme', 'new-project'))).toBeUndefined();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('blocks rapid duplicate submits while the POST is unresolved', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const request = deferred<Project>();
    mocks.createProject.mockReturnValue(request.promise);
    mocks.listProjectsForWorkspace
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([projectWithRole(createdProject)]);

    const client = createClient();
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    render(
      <Providers client={client}>
        <ProjectObserver workspaceSlug="acme" label="projects" />
        <ModalHost onCreated={onCreated} />
      </Providers>,
    );

    await waitFor(() => expect(mocks.listProjectsForWorkspace).toHaveBeenCalledOnce());
    await user.type(screen.getByLabelText('Name'), 'New project');
    const form = screen.getByLabelText('Name').closest('form')!;

    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalledOnce());
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();

    await act(async () => request.resolve(createdProject));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(invalidateQueries).toHaveBeenCalledOnce();
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: queryKeys.projects('acme'),
      exact: true,
    });
    expect(mocks.listProjectsForWorkspace).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
