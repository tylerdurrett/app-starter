import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import {
  MembershipSettings,
  type MembershipMember,
  type MembershipSettingsAdapter,
} from './membership-settings';
import { establishAuthenticatedClientOwner } from '../../lib/authenticated-client-state';

const ada: MembershipMember = {
  userId: 'user-1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'owner',
};
const grace: MembershipMember = {
  userId: 'user-2',
  name: 'Grace Hopper',
  email: 'grace@example.com',
  role: 'member',
};
const katherine: MembershipMember = {
  userId: 'user-3',
  name: 'Katherine Johnson',
  email: 'katherine@example.com',
  role: 'member',
};

function createAdapter(
  overrides: Partial<MembershipSettingsAdapter<MembershipMember>> = {},
): MembershipSettingsAdapter<MembershipMember> {
  return {
    queryKey: ['members'],
    listMembers: vi.fn().mockResolvedValue([ada, grace]),
    removeMember: vi.fn().mockResolvedValue(undefined),
    canList: true,
    canRemove: () => true,
    ...overrides,
  };
}

function renderMembership(
  adapter: MembershipSettingsAdapter<MembershipMember>,
  currentUserId: string | false = 'user-1',
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  window.localStorage.setItem('authenticatedClientOwner', 'test-user');
  void establishAuthenticatedClientOwner(queryClient, 'test-user');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(
    <MembershipSettings
      adapter={adapter}
      currentUserId={currentUserId === false ? undefined : currentUserId}
    />,
    { wrapper },
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('MembershipSettings', () => {
  it('does not query members when listing is forbidden', () => {
    const adapter = createAdapter({ canList: false });

    renderMembership(adapter);

    expect(screen.getByText("You don't have permission to view members.")).toBeInTheDocument();
    expect(adapter.listMembers).not.toHaveBeenCalled();
  });

  it('renders loading and empty states from the member query', async () => {
    const request = deferred<MembershipMember[]>();
    const adapter = createAdapter({ listMembers: vi.fn(() => request.promise) });

    renderMembership(adapter);

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    await act(async () => request.resolve([]));

    expect(await screen.findByText('No members yet.')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('renders members, roles, and the current-user annotation', async () => {
    renderMembership(createAdapter());

    expect(await screen.findByText(/Ada Lovelace/)).toHaveTextContent('Ada Lovelace(you)');
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.queryByTitle('Remove Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.getByTitle('Remove Grace Hopper')).toBeInTheDocument();
  });

  it('suppresses all removal controls while current-user identity is unresolved', async () => {
    renderMembership(createAdapter(), false);

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByTitle(/Remove /)).not.toBeInTheDocument();
    expect(screen.queryByText('(you)')).not.toBeInTheDocument();
  });

  it('honors resource-side removal vetoes', async () => {
    const adapter = createAdapter({ canRemove: (member) => member.role !== 'owner' });

    renderMembership(adapter, 'someone-else');

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByTitle('Remove Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.getByTitle('Remove Grace Hopper')).toBeInTheDocument();
  });

  it('tracks pending state on the selected row and explicitly refreshes after removal', async () => {
    const user = userEvent.setup();
    const removal = deferred<void>();
    const listMembers = vi
      .fn<() => Promise<MembershipMember[]>>()
      .mockResolvedValueOnce([ada, grace])
      .mockResolvedValueOnce([ada]);
    const removeMember = vi.fn(() => removal.promise);
    const adapter = createAdapter({ listMembers, removeMember });

    renderMembership(adapter, 'someone-else');

    const graceButton = await screen.findByTitle('Remove Grace Hopper');
    const adaButton = screen.getByTitle('Remove Ada Lovelace');
    await user.click(graceButton);

    expect(screen.getByTitle('Removing Grace Hopper')).toBeDisabled();
    expect(adaButton).toBeEnabled();
    expect(removeMember).toHaveBeenCalledWith('user-2');

    await act(async () => removal.resolve());

    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument());
  });

  it('tracks concurrent removals independently and prevents duplicate submissions', async () => {
    const user = userEvent.setup();
    const graceRemoval = deferred<void>();
    const katherineRemoval = deferred<void>();
    const listMembers = vi.fn().mockResolvedValue([ada, grace, katherine]);
    const removeMember = vi.fn((userId: string) => {
      if (userId === grace.userId) return graceRemoval.promise;
      if (userId === katherine.userId) return katherineRemoval.promise;
      return Promise.resolve();
    });
    renderMembership(createAdapter({ listMembers, removeMember }), 'someone-else');

    const graceButton = await screen.findByTitle('Remove Grace Hopper');
    const katherineButton = screen.getByTitle('Remove Katherine Johnson');
    act(() => {
      graceButton.click();
      graceButton.click();
    });
    await waitFor(() => expect(removeMember).toHaveBeenCalledOnce());
    await user.click(katherineButton);

    expect(removeMember).toHaveBeenCalledTimes(2);
    expect(removeMember).toHaveBeenCalledWith(grace.userId);
    expect(removeMember).toHaveBeenCalledWith(katherine.userId);
    expect(graceButton).toBeDisabled();
    expect(katherineButton).toBeDisabled();

    await act(async () => graceRemoval.resolve());
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(graceButton).toBeEnabled());
    expect(katherineButton).toBeDisabled();

    await act(async () => katherineRemoval.resolve());
    await waitFor(() => expect(listMembers).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(katherineButton).toBeEnabled());
  });

  it('retains structured errors from independently settling removals', async () => {
    const user = userEvent.setup();
    const graceRemoval = deferred<void>();
    const katherineRemoval = deferred<void>();
    const removeMember = vi.fn((userId: string) =>
      userId === grace.userId ? graceRemoval.promise : katherineRemoval.promise,
    );
    renderMembership(
      createAdapter({
        listMembers: vi.fn().mockResolvedValue([ada, grace, katherine]),
        removeMember,
      }),
      'someone-else',
    );

    await user.click(await screen.findByTitle('Remove Grace Hopper'));
    await user.click(screen.getByTitle('Remove Katherine Johnson'));

    await act(async () =>
      graceRemoval.reject(
        new ApiError(409, JSON.stringify({ error: { message: 'Grace owns a project' } })),
      ),
    );
    expect(await screen.findByText('Grace owns a project')).toBeInTheDocument();
    expect(screen.getByTitle('Remove Grace Hopper')).toBeEnabled();
    expect(screen.getByTitle('Removing Katherine Johnson')).toBeDisabled();

    await act(async () => katherineRemoval.reject(new Error('network unavailable')));
    expect(await screen.findByText('Failed to remove Katherine Johnson')).toBeInTheDocument();
    expect(screen.getByText('Grace owns a project')).toBeInTheDocument();
    expect(screen.getByTitle('Remove Katherine Johnson')).toBeEnabled();
  });

  it('presents structured query and removal errors with stable fallbacks', async () => {
    const queryError = new ApiError(
      403,
      JSON.stringify({ error: { message: 'Membership list is restricted' } }),
    );
    const failedQuery = createAdapter({ listMembers: vi.fn().mockRejectedValue(queryError) });

    const firstRender = renderMembership(failedQuery);
    expect(await screen.findByText('Membership list is restricted')).toBeInTheDocument();
    firstRender.unmount();

    const user = userEvent.setup();
    const removalError = new ApiError(
      409,
      JSON.stringify({ error: { message: 'This member owns the workspace' } }),
    );
    const failedRemoval = createAdapter({
      removeMember: vi.fn().mockRejectedValue(removalError),
    });
    renderMembership(failedRemoval, 'someone-else');

    await user.click(await screen.findByTitle('Remove Ada Lovelace'));

    expect(await screen.findByText('This member owns the workspace')).toBeInTheDocument();
    expect(screen.getByTitle('Remove Ada Lovelace')).toBeEnabled();
  });
});
