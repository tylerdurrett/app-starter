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
