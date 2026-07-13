import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveContext } from '../lib/active-workspace';
import type { Workspace, WorkspaceWithRole } from '../lib/workspaces';

const mocks = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  navigate: vi.fn(async () => undefined),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => mocks.navigate,
  Link: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

vi.mock('../lib/workspaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/workspaces')>()),
  createWorkspace: mocks.createWorkspace,
  listWorkspaces: mocks.listWorkspaces,
}));

vi.mock('../lib/auth-client', () => ({ signOut: vi.fn() }));

import { queryKeys } from '../lib/query-keys';
import { workspacesQueryOptions } from '../lib/workspace-queries';
import { CreateWorkspacePage } from '../routes/_app.onboarding.create-workspace';
import { WorkspaceSwitcher } from './workspace-switcher';

const createdWorkspace: Workspace = {
  id: 'workspace-new',
  slug: 'new-workspace',
  name: 'New workspace',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const createdWorkspaceWithRole: WorkspaceWithRole = {
  ...createdWorkspace,
  role: 'owner',
};

const activeContext: ActiveContext = {
  workspaceSlug: null,
  fromUrl: false,
  projectWorkspaceSlug: null,
  projectSlug: null,
  projectId: null,
  urlProjectWorkspaceName: null,
};

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function WorkspaceObserver({ label }: { label: string }) {
  const query = useQuery(workspacesQueryOptions());
  return (
    <div data-testid={label}>
      {query.data?.map((workspace) => workspace.name).join(', ') ?? 'Loading'}
    </div>
  );
}

function renderWithClient(client: QueryClient, children: ReactNode) {
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
}

describe('workspace creation mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.navigate.mockResolvedValue(undefined);
  });

  it('refreshes every shared list observer once before switcher navigation without seeding detail', async () => {
    const user = userEvent.setup();
    mocks.createWorkspace.mockResolvedValue(createdWorkspace);
    mocks.listWorkspaces
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdWorkspaceWithRole]);
    const client = createClient();

    renderWithClient(
      client,
      <>
        <WorkspaceObserver label="nav-list" />
        <WorkspaceObserver label="page-list" />
        <WorkspaceSwitcher activeContext={activeContext} />
      </>,
    );

    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'New workspace' }));
    await user.type(screen.getByPlaceholderText('Workspace name'), '  New workspace  ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByTestId('nav-list')).toHaveTextContent('New workspace');
      expect(screen.getByTestId('page-list')).toHaveTextContent('New workspace');
    });
    expect(mocks.createWorkspace).toHaveBeenCalledOnce();
    expect(mocks.createWorkspace).toHaveBeenCalledWith('New workspace');
    expect(mocks.listWorkspaces).toHaveBeenCalledTimes(3);
    expect(client.getQueryData(queryKeys.workspace('new-workspace'))).toBeUndefined();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/w/$workspaceSlug',
      params: { workspaceSlug: 'new-workspace' },
    });
  });

  it('keeps the switcher form retryable after a failed mutation without refreshing the list', async () => {
    const user = userEvent.setup();
    mocks.listWorkspaces.mockResolvedValue([]);
    mocks.createWorkspace
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(createdWorkspace);
    const client = createClient();

    renderWithClient(client, <WorkspaceSwitcher activeContext={activeContext} />);
    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: 'New workspace' }));
    await user.type(screen.getByPlaceholderText('Workspace name'), 'New workspace');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to create workspace');
    expect(screen.getByPlaceholderText('Workspace name')).toHaveValue('New workspace');
    expect(mocks.listWorkspaces).toHaveBeenCalledTimes(2);
    expect(mocks.navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce());
    expect(mocks.createWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.listWorkspaces).toHaveBeenCalledTimes(3);
  });

  it('refreshes the exact shared list once before onboarding navigation', async () => {
    const user = userEvent.setup();
    mocks.createWorkspace.mockResolvedValue(createdWorkspace);
    mocks.listWorkspaces
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdWorkspaceWithRole]);
    const client = createClient();

    renderWithClient(
      client,
      <>
        <WorkspaceObserver label="nav-list" />
        <WorkspaceObserver label="page-list" />
        <CreateWorkspacePage />
      </>,
    );

    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledOnce());
    await user.type(screen.getByLabelText('Workspace Name'), '  New workspace  ');
    await user.click(screen.getByRole('button', { name: 'Create Workspace' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce());
    expect(screen.getByTestId('nav-list')).toHaveTextContent('New workspace');
    expect(screen.getByTestId('page-list')).toHaveTextContent('New workspace');
    expect(mocks.createWorkspace).toHaveBeenCalledOnce();
    expect(mocks.createWorkspace).toHaveBeenCalledWith('New workspace');
    expect(mocks.listWorkspaces).toHaveBeenCalledTimes(2);
    expect(client.getQueryData(queryKeys.workspace('new-workspace'))).toBeUndefined();
  });

  it('keeps onboarding input retryable after failure and avoids duplicate submit/refetch', async () => {
    const user = userEvent.setup();
    mocks.listWorkspaces.mockResolvedValue([]);
    mocks.createWorkspace
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(createdWorkspace);
    const client = createClient();

    renderWithClient(
      client,
      <>
        <WorkspaceObserver label="list" />
        <CreateWorkspacePage />
      </>,
    );

    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledOnce());
    await user.type(screen.getByLabelText('Workspace Name'), 'New workspace');
    await user.click(screen.getByRole('button', { name: 'Create Workspace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to create workspace. Please try again.',
    );
    expect(screen.getByLabelText('Workspace Name')).toHaveValue('New workspace');
    expect(mocks.createWorkspace).toHaveBeenCalledOnce();
    expect(mocks.listWorkspaces).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Create Workspace' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledOnce());
    expect(mocks.createWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.listWorkspaces).toHaveBeenCalledTimes(2);
  });
});
