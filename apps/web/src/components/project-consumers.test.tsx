import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectWithRole } from '../lib/projects';

const mocks = vi.hoisted(() => ({
  listProjectsForWorkspace: vi.fn(),
  listWorkspaceMembers: vi.fn(async () => []),
  navigate: vi.fn(async () => undefined),
  workspace: {
    id: 'workspace-1',
    name: 'Acme',
    slug: 'acme',
    role: 'owner' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
}));

vi.mock('../lib/workspaces', () => ({
  listProjectsForWorkspace: mocks.listProjectsForWorkspace,
  listWorkspaceMembers: mocks.listWorkspaceMembers,
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  getRouteApi: () => ({ useLoaderData: () => ({ workspace: mocks.workspace }) }),
  useNavigate: () => mocks.navigate,
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params: Record<string, string>;
    children: ReactNode;
  } & Omit<ComponentProps<'a'>, 'href'>) => {
    const href = Object.entries(params).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to,
    );
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
}));

vi.mock('./create-project-modal', () => ({
  CreateProjectModal: ({
    open,
    onOpenChange,
    onCreated,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (project: {
      id: string;
      workspaceId: string;
      workspaceSlug: string;
      workspaceName: string;
      slug: string;
      name: string;
      createdAt: string;
      updatedAt: string;
    }) => void;
  }) =>
    open ? (
      <div role="dialog">
        Create project modal
        <button
          type="button"
          onClick={() => {
            onCreated({
              id: 'project-new',
              workspaceId: 'workspace-acme',
              workspaceSlug: 'acme',
              workspaceName: 'Acme',
              slug: 'new-project',
              name: 'New project',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            });
            onOpenChange(false);
          }}
        >
          Complete project creation
        </button>
      </div>
    ) : null,
}));

import { queryKeys } from '../lib/query-keys';
import { WorkspaceHomePage } from '../routes/_app.w.$workspaceSlug.index';
import { ProjectSwitcher } from './project-switcher';

function project(workspaceSlug: string, slug: string, name: string): ProjectWithRole {
  return {
    id: `${workspaceSlug}-${slug}`,
    workspaceId: `workspace-${workspaceSlug}`,
    workspaceSlug,
    workspaceName: workspaceSlug,
    slug,
    name,
    role: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
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

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('workspace project query consumers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWorkspaceMembers.mockResolvedValue([]);
  });

  it('keeps switcher loading, active, settings, modal, and empty UI scoped to the workspace', async () => {
    const user = userEvent.setup();
    const acmeRequest = deferred<ProjectWithRole[]>();
    const betaRequest = deferred<ProjectWithRole[]>();
    mocks.listProjectsForWorkspace.mockImplementation((slug: string) =>
      slug === 'acme' ? acmeRequest.promise : betaRequest.promise,
    );
    const client = createClient();
    const view = render(
      <Providers client={client}>
        <ProjectSwitcher
          workspaceSlug="acme"
          workspaceRole="owner"
          activeProjectSlug="apollo"
        />
      </Providers>,
    );

    await user.click(screen.getByRole('button', { name: 'Switch project' }));
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    const apollo = project('acme', 'apollo', 'Apollo');
    await act(async () => acmeRequest.resolve([apollo]));

    const activeLink = await screen.findByRole('link', { name: /Apollo/ });
    expect(activeLink).toHaveClass('bg-accent');
    expect(screen.getByRole('link', { name: 'Project settings' })).toHaveAttribute(
      'href',
      '/w/acme/p/apollo/settings',
    );

    await user.click(screen.getByRole('button', { name: 'New project' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Create project modal');

    view.rerender(
      <Providers client={client}>
        <ProjectSwitcher
          workspaceSlug="beta"
          workspaceRole="owner"
          activeProjectSlug={null}
        />
      </Providers>,
    );
    await user.click(screen.getByRole('button', { name: 'Switch project' }));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Apollo')).not.toBeInTheDocument();

    await act(async () => betaRequest.resolve([]));
    expect(await screen.findByText('No projects yet')).toBeInTheDocument();
    expect(client.getQueryData(queryKeys.projects('acme'))).toEqual([apollo]);
    expect(client.getQueryData(queryKeys.projects('beta'))).toEqual([]);
    expect(mocks.listProjectsForWorkspace.mock.calls.map(([slug]) => slug)).toEqual([
      'acme',
      'beta',
    ]);
  });

  it('renders Query-owned errors in the switcher', async () => {
    const user = userEvent.setup();
    mocks.listProjectsForWorkspace.mockRejectedValue(new Error('offline'));

    render(
      <Providers client={createClient()}>
        <ProjectSwitcher
          workspaceSlug="acme"
          workspaceRole="owner"
          activeProjectSlug={null}
        />
      </Providers>,
    );

    await user.click(screen.getByRole('button', { name: 'Switch project' }));
    expect(await screen.findByText('Failed to load projects')).toBeInTheDocument();
  });

  it('keeps the switcher creation callback limited to navigation and modal UI', async () => {
    const user = userEvent.setup();
    mocks.listProjectsForWorkspace.mockResolvedValue([]);

    render(
      <Providers client={createClient()}>
        <ProjectSwitcher
          workspaceSlug="acme"
          workspaceRole="owner"
          activeProjectSlug={null}
        />
      </Providers>,
    );

    await user.click(screen.getByRole('button', { name: 'Switch project' }));
    await user.click(await screen.findByRole('button', { name: 'New project' }));
    await user.click(screen.getByRole('button', { name: 'Complete project creation' }));

    expect(mocks.navigate).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/w/$workspaceSlug/p/$projectSlug',
      params: { workspaceSlug: 'acme', projectSlug: 'new-project' },
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not restart an in-flight mount refetch when opened with stale cached data', async () => {
    const user = userEvent.setup();
    const request = deferred<ProjectWithRole[]>();
    mocks.listProjectsForWorkspace.mockReturnValue(request.promise);
    const client = createClient();
    const cachedProject = project('acme', 'cached', 'Cached project');
    client.setQueryData(queryKeys.projects('acme'), [cachedProject]);

    render(
      <Providers client={client}>
        <ProjectSwitcher
          workspaceSlug="acme"
          workspaceRole="owner"
          activeProjectSlug="cached"
        />
      </Providers>,
    );

    await waitFor(() => expect(mocks.listProjectsForWorkspace).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: 'Switch project' }));

    expect(screen.getByRole('link', { name: /Cached project/ })).toBeInTheDocument();
    expect(mocks.listProjectsForWorkspace).toHaveBeenCalledOnce();

    await act(async () => request.resolve([project('acme', 'fresh', 'Fresh project')]));
    expect(await screen.findByRole('link', { name: /Fresh project/ })).toBeInTheDocument();
  });

  it('renders Query-owned empty and error states on workspace home', async () => {
    mocks.listProjectsForWorkspace.mockResolvedValueOnce([]);
    const emptyView = render(
      <Providers client={createClient()}>
        <WorkspaceHomePage />
      </Providers>,
    );

    expect(await screen.findByText('No projects yet.')).toBeInTheDocument();
    emptyView.unmount();

    mocks.listProjectsForWorkspace.mockRejectedValueOnce(new Error('offline'));
    render(
      <Providers client={createClient()}>
        <WorkspaceHomePage />
      </Providers>,
    );

    expect(await screen.findByText('Failed to load projects')).toBeInTheDocument();
  });

  it('shares one in-flight request and cache entry between home and switcher observers', async () => {
    const user = userEvent.setup();
    const request = deferred<ProjectWithRole[]>();
    mocks.listProjectsForWorkspace.mockReturnValue(request.promise);
    const client = createClient();

    render(
      <Providers client={client}>
        <WorkspaceHomePage />
        <ProjectSwitcher
          workspaceSlug="acme"
          workspaceRole="owner"
          activeProjectSlug="apollo"
        />
      </Providers>,
    );

    await user.click(screen.getByRole('button', { name: 'Switch project' }));
    expect(screen.getAllByText('Loading...').length).toBeGreaterThanOrEqual(2);
    expect(mocks.listProjectsForWorkspace).toHaveBeenCalledOnce();

    const apollo = project('acme', 'apollo', 'Apollo');
    await act(async () => request.resolve([apollo]));

    await waitFor(() => expect(screen.getAllByText('Apollo')).toHaveLength(2));
    expect(mocks.listProjectsForWorkspace).toHaveBeenCalledOnce();
    expect(client.getQueryData(queryKeys.projects('acme'))).toEqual([apollo]);
  });
});
