import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: {
    data: { user: { id: 'user-a' } } as { user: { id: string } } | null,
    isPending: false,
    isRefetching: false,
  },
  invalidate: vi.fn(async () => {}),
  navigate: vi.fn(async () => {}),
  privateRead: vi.fn(),
}));

vi.mock('../lib/auth-client', () => ({
  useSession: () => mocks.session,
}));

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: mocks.invalidate, navigate: mocks.navigate }),
}));

import { AuthenticatedClientBoundary } from './authenticated-client-boundary';
import {
  authenticatedQueryEnabled,
  establishAuthenticatedClientOwner,
} from '../lib/authenticated-client-state';
import { readActiveContext, writeActiveContext } from '../lib/active-workspace';

function PrivateConsumer({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  useQuery({
    queryKey: ['private', userId],
    queryFn: mocks.privateRead,
    enabled: authenticatedQueryEnabled(queryClient, true),
  });
  return <div>{userId}</div>;
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.session.data = { user: { id: 'user-a' } };
  mocks.session.isPending = false;
  mocks.session.isRefetching = false;
  mocks.invalidate.mockClear();
  mocks.navigate.mockClear();
  mocks.privateRead.mockReset();
});

describe('AuthenticatedClientBoundary', () => {
  it('fails closed while the initial reactive session has no validated owner', () => {
    mocks.session.data = null;
    mocks.session.isPending = true;
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedClientBoundary>
          <div>private shell</div>
        </AuthenticatedClientBoundary>
      </QueryClientProvider>,
    );

    expect(screen.queryByText('private shell')).not.toBeInTheDocument();
  });

  it('unmounts private queries while the session refetch retains prior user data', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    await establishAuthenticatedClientOwner(queryClient, 'user-a');
    queryClient.setQueryData(['private', 'user-a'], { secret: true });

    const view = render(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedClientBoundary>
          <PrivateConsumer userId="user-a" />
        </AuthenticatedClientBoundary>
      </QueryClientProvider>,
    );
    expect(screen.getByText('user-a')).toBeInTheDocument();

    mocks.session.isRefetching = true;
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedClientBoundary>
          <PrivateConsumer userId="user-a" />
        </AuthenticatedClientBoundary>
      </QueryClientProvider>,
    );

    expect(screen.queryByText('user-a')).not.toBeInTheDocument();
    expect(queryClient.getQueryCache().findAll()).toHaveLength(1);
    expect(mocks.privateRead).not.toHaveBeenCalled();
  });

  it('blocks mounted user B reads until a cross-tab session change clears user A', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    await establishAuthenticatedClientOwner(queryClient, 'user-a');
    queryClient.setQueryData(['private', 'user-a'], { secret: true });
    writeActiveContext({ workspaceSlug: 'a', projectSlug: 'private', projectId: 'p-a' });
    mocks.privateRead.mockImplementation(async () => {
      expect(queryClient.getQueryData(['private', 'user-a'])).toBeUndefined();
      expect(readActiveContext()).toBeNull();
      return { secret: 'user-b' };
    });

    const view = render(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedClientBoundary>
          <PrivateConsumer userId="user-a" />
        </AuthenticatedClientBoundary>
      </QueryClientProvider>,
    );
    expect(screen.getByText('user-a')).toBeInTheDocument();

    mocks.session.data = { user: { id: 'user-b' } };
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedClientBoundary>
          <PrivateConsumer userId="user-b" />
        </AuthenticatedClientBoundary>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('user-b')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('user-b')).toBeInTheDocument());
    expect(mocks.privateRead).toHaveBeenCalledOnce();
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });

  it('keeps the shell hidden and navigates out when the mounted session disappears', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    await establishAuthenticatedClientOwner(queryClient, 'user-a');
    queryClient.setQueryData(['private', 'user-a'], { secret: true });

    const view = render(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedClientBoundary>
          <PrivateConsumer userId="user-a" />
        </AuthenticatedClientBoundary>
      </QueryClientProvider>,
    );
    expect(screen.getByText('user-a')).toBeInTheDocument();

    mocks.session.data = null;
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <AuthenticatedClientBoundary>
          <PrivateConsumer userId="user-a" />
        </AuthenticatedClientBoundary>
      </QueryClientProvider>,
    );

    expect(screen.queryByText('user-a')).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/login' }));
    expect(queryClient.getQueryCache().findAll()).toEqual([]);
    expect(mocks.privateRead).not.toHaveBeenCalled();
    expect(screen.queryByText('user-a')).not.toBeInTheDocument();
  });
});
