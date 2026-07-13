import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { InviteSettings } from './invite-settings';
import type { InviteSettingsAdapter, PendingInvite } from './invite-settings';

vi.hoisted(() => {
  vi.stubEnv('VITE_SERVER_URL', 'http://localhost:3001');
});

const invites: PendingInvite[] = [
  {
    id: 'invite-1',
    email: 'one@example.com',
    role: 'member',
    invitedByName: 'Ada',
    expiresAt: '2030-01-02T00:00:00.000Z',
  },
  {
    id: 'invite-2',
    email: 'two@example.com',
    role: 'manager',
    invitedByName: 'Grace',
    expiresAt: '2030-02-03T00:00:00.000Z',
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function adapter(overrides: Partial<InviteSettingsAdapter> = {}): InviteSettingsAdapter {
  return {
    queryKey: ['settings', 'invites'],
    listInvites: vi.fn().mockResolvedValue(invites),
    createInvite: vi.fn().mockResolvedValue({ inviteUrl: 'https://example.com/invite/one' }),
    revokeInvite: vi.fn().mockResolvedValue(undefined),
    refreshInvites: vi.fn().mockResolvedValue(undefined),
    canList: true,
    canCreate: true,
    canRevoke: true,
    ...overrides,
  };
}

function renderSettings(settingsAdapter: InviteSettingsAdapter) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(<InviteSettings adapter={settingsAdapter} />, { wrapper: Wrapper });
}

describe('InviteSettings', () => {
  it('owns list loading, rendering, permissions, and empty states', async () => {
    const list = deferred<PendingInvite[]>();
    const settingsAdapter = adapter({
      listInvites: vi.fn(() => list.promise),
      canCreate: false,
      canRevoke: false,
    });
    const view = renderSettings(settingsAdapter);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite member' })).not.toBeInTheDocument();

    list.resolve(invites);

    expect(await screen.findByText('one@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Role: manager.*Invited by Grace/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revoke invite/ })).not.toBeInTheDocument();

    view.unmount();
    renderSettings(adapter({ listInvites: vi.fn().mockResolvedValue([]) }));

    expect(await screen.findByText('No pending invites.')).toBeInTheDocument();
  });

  it('presents structured and fallback list errors and does not query without list permission', async () => {
    const structuredFailure = vi
      .fn()
      .mockRejectedValue(
        new ApiError(403, JSON.stringify({ error: { message: 'Invites are unavailable' } })),
      );
    const view = renderSettings(adapter({ listInvites: structuredFailure }));

    expect(await screen.findByText('Invites are unavailable')).toBeInTheDocument();

    view.unmount();
    const failedList = vi.fn().mockRejectedValue(new Error('network detail'));
    const fallbackView = renderSettings(adapter({ listInvites: failedList }));

    expect(await screen.findByText('Failed to load invites')).toBeInTheDocument();

    fallbackView.unmount();
    const forbiddenList = vi.fn().mockResolvedValue(invites);
    renderSettings(adapter({ listInvites: forbiddenList, canList: false }));

    await waitFor(() => expect(forbiddenList).not.toHaveBeenCalled());
    expect(screen.queryByText('No pending invites.')).not.toBeInTheDocument();
  });

  it('guards blank email and creates a trimmed manager invite with pending protection and refresh', async () => {
    const user = userEvent.setup();
    const create = deferred<{ inviteUrl: string }>();
    const refresh = deferred<void>();
    const settingsAdapter = adapter({
      createInvite: vi.fn(() => create.promise),
      refreshInvites: vi.fn(() => refresh.promise),
    });
    renderSettings(settingsAdapter);
    await screen.findByText('one@example.com');

    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    const email = screen.getByLabelText('Email address');
    const form = screen.getByRole('form', { name: 'Create invite' });
    await user.type(email, '   ');
    fireEvent.submit(form);
    expect(settingsAdapter.createInvite).not.toHaveBeenCalled();

    await user.clear(email);
    await user.type(email, '  teammate@example.com  ');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'manager');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(settingsAdapter.createInvite).toHaveBeenCalledWith('teammate@example.com', 'manager');
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
    expect(email).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Role' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    create.resolve({ inviteUrl: 'https://example.com/invite/new' });
    expect(await screen.findByText('https://example.com/invite/new')).toBeInTheDocument();
    expect(settingsAdapter.refreshInvites).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();

    refresh.resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(email).toHaveValue('');
  });

  it('copies the generated URL, clears stale output before another create, and cleans up its timer', async () => {
    const user = userEvent.setup();
    const nextCreate = deferred<{ inviteUrl: string }>();
    const createInvite = vi
      .fn<InviteSettingsAdapter['createInvite']>()
      .mockResolvedValueOnce({ inviteUrl: 'https://example.com/invite/first' })
      .mockImplementationOnce(() => nextCreate.promise);
    const settingsAdapter = adapter({ createInvite });
    const view = renderSettings(settingsAdapter);
    await screen.findByText('one@example.com');
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await user.type(screen.getByLabelText('Email address'), 'first@example.com');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('https://example.com/invite/first')).toBeInTheDocument();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Copy invite link' }));
    expect(writeText).toHaveBeenCalledWith('https://example.com/invite/first');
    expect(screen.getByText('Copied!')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email address'), 'second@example.com');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.queryByText('https://example.com/invite/first')).not.toBeInTheDocument();
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument();

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    view.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    nextCreate.resolve({ inviteUrl: 'https://example.com/invite/second' });
  });

  it('shows structured create errors and Cancel fully resets form state and errors', async () => {
    const user = userEvent.setup();
    const settingsAdapter = adapter({
      createInvite: vi
        .fn()
        .mockRejectedValue(
          new ApiError(409, JSON.stringify({ error: { message: 'Already invited' } })),
        ),
    });
    renderSettings(settingsAdapter);
    await screen.findByText('one@example.com');
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    await user.type(screen.getByLabelText('Email address'), 'duplicate@example.com');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'manager');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('Already invited')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Create invite' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    expect(screen.getByLabelText('Email address')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveValue('member');
    expect(screen.queryByText('Already invited')).not.toBeInTheDocument();
  });

  it('tracks revoke pending state per invite, refreshes after success, and presents API errors', async () => {
    const user = userEvent.setup();
    const firstRevoke = deferred<unknown>();
    const secondRevoke = deferred<unknown>();
    const revokeInvite = vi
      .fn<InviteSettingsAdapter['revokeInvite']>()
      .mockImplementationOnce(() => firstRevoke.promise)
      .mockImplementationOnce(() => secondRevoke.promise)
      .mockRejectedValueOnce(
        new ApiError(403, JSON.stringify({ error: { message: 'Invite cannot be revoked' } })),
      );
    const settingsAdapter = adapter({ revokeInvite });
    renderSettings(settingsAdapter);
    await screen.findByText('one@example.com');

    const firstButton = screen.getByRole('button', { name: 'Revoke invite for one@example.com' });
    const secondButton = screen.getByRole('button', { name: 'Revoke invite for two@example.com' });
    await user.click(firstButton);
    expect(firstButton).toBeDisabled();
    expect(secondButton).toBeEnabled();
    expect(revokeInvite).toHaveBeenCalledWith('invite-1');

    await user.click(secondButton);
    expect(firstButton).toBeDisabled();
    expect(secondButton).toBeDisabled();
    expect(revokeInvite).toHaveBeenCalledTimes(2);
    expect(revokeInvite).toHaveBeenLastCalledWith('invite-2');

    await user.click(firstButton);
    await user.click(secondButton);
    expect(revokeInvite).toHaveBeenCalledTimes(2);

    firstRevoke.resolve(undefined);
    await waitFor(() => expect(settingsAdapter.refreshInvites).toHaveBeenCalledOnce());
    await waitFor(() => expect(firstButton).toBeEnabled());
    expect(secondButton).toBeDisabled();

    secondRevoke.resolve(undefined);
    await waitFor(() => expect(settingsAdapter.refreshInvites).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(secondButton).toBeEnabled());
    await user.click(secondButton);
    expect(await screen.findByText('Invite cannot be revoked')).toBeInTheDocument();
    expect(revokeInvite).toHaveBeenLastCalledWith('invite-2');
  });
});
