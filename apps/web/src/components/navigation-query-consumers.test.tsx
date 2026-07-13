import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveContext } from '../lib/active-workspace';
import type { WorkspaceWithRole } from '../lib/workspaces';

const mocks = vi.hoisted(() => ({
  pathname: '/account',
  routeWorkspaceSlug: null as string | null,
  activeContext: null as ActiveContext | null,
  useActiveContext: vi.fn(),
  listWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  navigate: vi.fn(async () => undefined),
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => ({ location: { pathname: mocks.pathname } }),
  useMatch: () =>
    mocks.routeWorkspaceSlug
      ? {
          params: { workspaceSlug: mocks.routeWorkspaceSlug },
          loaderData: {
            workspace: {
              id: 'workspace-loader',
              slug: 'loader',
              name: 'Loader snapshot',
              role: 'owner',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }
      : undefined,
  useNavigate: () => mocks.navigate,
  Link: ({
    to,
    params = {},
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
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

vi.mock('../lib/active-workspace', () => ({
  useActiveContext: mocks.useActiveContext,
}));

vi.mock('../lib/workspaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/workspaces')>()),
  listWorkspaces: mocks.listWorkspaces,
  getWorkspace: mocks.getWorkspace,
}));

vi.mock('../lib/auth-client', () => ({
  signOut: vi.fn(),
}));

vi.mock('./project-switcher', () => ({
  ProjectSwitcher: ({
    workspaceSlug,
    workspaceRole,
  }: {
    workspaceSlug: string;
    workspaceRole: string;
  }) => <output data-testid="project-switcher">{`${workspaceSlug}:${workspaceRole}`}</output>,
}));

import { queryKeys } from '../lib/query-keys';
import { establishAuthenticatedClientOwner } from '../lib/authenticated-client-state';
import { NavRail } from './nav-rail';

function workspace(
  slug: string,
  name: string,
  role: WorkspaceWithRole['role'] = 'owner',
): WorkspaceWithRole {
  return {
    id: `workspace-${slug}`,
    slug,
    name,
    role,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function activeContext(overrides: Partial<ActiveContext> = {}): ActiveContext {
  return {
    workspaceSlug: null,
    fromUrl: false,
    projectWorkspaceSlug: null,
    projectSlug: null,
    projectId: null,
    urlProjectWorkspaceName: null,
    ...overrides,
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  window.localStorage.setItem('authenticatedClientOwner', 'test-user');
  void establishAuthenticatedClientOwner(queryClient, 'test-user');
  return queryClient;
}

function renderNav(client = createClient()) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <NavRail />
      </QueryClientProvider>,
    ),
  };
}

describe('navigation workspace Query consumers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWorkspaces.mockReset();
    mocks.getWorkspace.mockReset();
    mocks.navigate.mockReset().mockResolvedValue(undefined);
    mocks.pathname = '/account';
    mocks.routeWorkspaceSlug = null;
    mocks.activeContext = activeContext();
    mocks.useActiveContext.mockImplementation(() => mocks.activeContext!);
  });

  it('renders mutable role and display data from the loader-seeded detail Query', () => {
    mocks.pathname = '/w/acme';
    mocks.routeWorkspaceSlug = 'acme';
    mocks.activeContext = activeContext({ workspaceSlug: 'acme', fromUrl: true });
    mocks.getWorkspace.mockReturnValue(new Promise(() => undefined));
    mocks.listWorkspaces.mockReturnValue(new Promise(() => undefined));
    const client = createClient();
    client.setQueryData(queryKeys.workspace('acme'), workspace('acme', 'Zulu', 'member'));

    renderNav(client);

    expect(screen.getByTestId('project-switcher')).toHaveTextContent('acme:member');
    expect(screen.getByRole('button', { name: 'Switch workspace' })).toHaveTextContent('Z');
    expect(mocks.getWorkspace).toHaveBeenCalledOnce();
  });

  it('shares one list request, has one reconciliation consumer, and does not restart on open', async () => {
    const user = userEvent.setup();
    const request = deferred<WorkspaceWithRole[]>();
    mocks.listWorkspaces.mockReturnValue(request.promise);

    renderNav();
    await waitFor(() => expect(mocks.listWorkspaces).toHaveBeenCalledOnce());
    expect(mocks.useActiveContext).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(mocks.listWorkspaces).toHaveBeenCalledOnce();

    await act(async () => request.resolve([workspace('acme', 'Acme')]));
    expect(await screen.findByRole('link', { name: /Acme/ })).toBeInTheDocument();
    expect(screen.getByTestId('project-switcher')).toHaveTextContent('acme:owner');
  });

  it('keeps last-good navigation and switcher options after a transient refetch error', async () => {
    const user = userEvent.setup();
    const request = deferred<WorkspaceWithRole[]>();
    mocks.listWorkspaces.mockReturnValue(request.promise);
    const client = createClient();
    client.setQueryData(queryKeys.workspaces(), [workspace('acme', 'Acme')]);

    renderNav(client);
    expect(screen.getByTestId('project-switcher')).toHaveTextContent('acme:owner');
    await act(async () => request.reject(new Error('offline')));
    await waitFor(() => expect(client.getQueryState(queryKeys.workspaces())?.status).toBe('error'));

    expect(screen.getByTestId('project-switcher')).toHaveTextContent('acme:owner');
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    expect(screen.getByRole('link', { name: /Acme/ })).toBeInTheDocument();
    expect(screen.queryByText('Failed to load workspaces')).not.toBeInTheDocument();
  });

  it('keeps the remembered Dashboard workspace/project pair coherent when falling back to the first workspace', async () => {
    mocks.activeContext = activeContext({
      workspaceSlug: 'remembered',
      projectWorkspaceSlug: 'remembered',
      projectSlug: 'dashboard',
      projectId: 'project-dashboard',
    });
    mocks.listWorkspaces.mockResolvedValue([workspace('first', 'First')]);

    renderNav();

    const dashboard = await screen.findByRole('link', { name: 'Dashboard' });
    expect(screen.getByTestId('project-switcher')).toHaveTextContent('first:owner');
    expect(dashboard).toHaveAttribute('href', '/w/remembered/p/dashboard');
  });

  it('renders first-load error and a successful empty list without inventing an active workspace', async () => {
    const user = userEvent.setup();
    mocks.listWorkspaces.mockRejectedValue(new Error('offline'));
    const failed = renderNav();
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    expect(await screen.findByText('Failed to load workspaces')).toBeInTheDocument();
    expect(screen.queryByTestId('project-switcher')).not.toBeInTheDocument();
    failed.unmount();

    mocks.listWorkspaces.mockResolvedValueOnce([]);
    renderNav();
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    expect(await screen.findByText('No workspaces yet')).toBeInTheDocument();
    expect(screen.queryByTestId('project-switcher')).not.toBeInTheDocument();
  });

  it('preserves project-only workspace display without granting workspace permissions', async () => {
    const user = userEvent.setup();
    mocks.pathname = '/w/hidden/p/shared';
    mocks.routeWorkspaceSlug = 'hidden';
    mocks.activeContext = activeContext({
      workspaceSlug: 'hidden',
      fromUrl: true,
      projectWorkspaceSlug: 'hidden',
      projectSlug: 'shared',
      projectId: 'project-shared',
      urlProjectWorkspaceName: 'Hidden workspace',
    });
    mocks.getWorkspace.mockRejectedValue(new Error('forbidden'));
    mocks.listWorkspaces.mockResolvedValue([workspace('acme', 'Acme')]);

    renderNav();
    expect(screen.getByRole('button', { name: 'Switch workspace' })).toHaveTextContent('H');
    expect(screen.queryByTestId('project-switcher')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch workspace' }));
    expect(await screen.findByText('project-only access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Workspace settings' })).not.toBeInTheDocument();
  });
});
