import { QueryClient, QueryClientProvider, type QueryClientConfig } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { NameSettings, type NameSettingsAdapter } from './name-settings';

interface TestResource {
  name: string;
  id: string;
}

const queryKey = ['test-resource'] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function setup({
  canEdit = true,
  updateName = vi.fn(async () => undefined),
  refresh,
  children,
  queryClientConfig,
}: {
  canEdit?: boolean;
  updateName?: NameSettingsAdapter<TestResource>['updateName'];
  refresh?: NameSettingsAdapter<TestResource>['refresh'];
  children?: ReactNode;
  queryClientConfig?: QueryClientConfig;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    ...queryClientConfig,
  });
  queryClient.setQueryData<TestResource>(queryKey, { id: 'resource-1', name: 'Original name' });

  const adapter: NameSettingsAdapter<TestResource> = {
    queryOptions: {
      queryKey,
      queryFn: async () => queryClient.getQueryData<TestResource>(queryKey)!,
      staleTime: Infinity,
    },
    canEdit,
    inputPlaceholder: 'Resource name',
    errorFallback: 'Failed to update resource name',
    updateName,
    refresh: refresh ?? (async () => undefined),
  };

  render(
    <QueryClientProvider client={queryClient}>
      <NameSettings adapter={adapter}>{children}</NameSettings>
    </QueryClientProvider>,
  );

  return { queryClient, updateName };
}

describe('NameSettings', () => {
  it('renders the live Query name and resource-specific content in read-only mode', async () => {
    const { queryClient } = setup({
      canEdit: false,
      children: <p>Slug: original-name</p>,
    });

    expect(screen.getByText('Original name')).toBeInTheDocument();
    expect(screen.getByText('Slug: original-name')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();

    act(() => {
      queryClient.setQueryData<TestResource>(queryKey, { id: 'resource-1', name: 'Live name' });
    });
    expect(await screen.findByText('Live name')).toBeInTheDocument();
  });

  it('opens with the current name, guards blank input, and resets edits on cancel', async () => {
    const user = userEvent.setup();
    const updateName = vi.fn(async () => undefined);
    setup({ updateName });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input).toHaveValue('Original name');

    await user.clear(input);
    await user.type(input, '   ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(updateName).not.toHaveBeenCalled();

    await user.type(input, 'discard me');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Original name');
  });

  it('trims the name, protects pending controls, refreshes explicitly, then closes', async () => {
    const user = userEvent.setup();
    const updateFinished = deferred<undefined>();
    const refreshFinished = deferred<undefined>();
    const events: string[] = [];
    const updateName = vi.fn(async (name: string) => {
      events.push(`update:${name}`);
      await updateFinished.promise;
    });
    const refresh = vi.fn(async (queryClient: QueryClient) => {
      events.push('refresh');
      await refreshFinished.promise;
      queryClient.setQueryData<TestResource>(queryKey, { id: 'resource-1', name: 'Renamed' });
    });
    setup({ updateName, refresh });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const input = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(input);
    await user.type(input, '  Renamed  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateName.mock.calls[0]?.[0]).toBe('Renamed');
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    updateFinished.resolve(undefined);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(events).toEqual(['update:Renamed', 'refresh']);
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();

    refreshFinished.resolve(undefined);
    expect(await screen.findByText('Renamed')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Name updated');
  });

  it('keeps the editor open and presents structured API errors, then resets them', async () => {
    const user = userEvent.setup();
    const updateName = vi.fn(async () => {
      throw new ApiError(409, JSON.stringify({ error: { message: 'That name is taken' } }));
    });
    setup({ updateName });

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That name is taken');
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
