import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  ConfirmedDeleteSettings,
  type ConfirmedDeleteSettingsAdapter,
} from './confirmed-delete-settings';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createAdapter(
  overrides: Partial<ConfirmedDeleteSettingsAdapter> = {},
): ConfirmedDeleteSettingsAdapter {
  return {
    resourceName: 'Roadmap',
    title: 'Delete this project',
    consequence: 'All project data will be permanently deleted.',
    revealButton: 'Delete project',
    confirmButton: 'Permanently delete',
    pendingButton: 'Deleting project...',
    errorFallback: 'Failed to delete project',
    deleteResource: vi.fn().mockResolvedValue(undefined),
    refreshAfterDelete: vi.fn().mockResolvedValue(undefined),
    onDeleted: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function renderDelete(adapter: ConfirmedDeleteSettingsAdapter) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={client}>
      <ConfirmedDeleteSettings adapter={adapter} />
    </QueryClientProvider>,
  );
}

async function reveal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Delete project' }));
  return screen.getByRole('textbox', { name: 'Confirmation' });
}

describe('ConfirmedDeleteSettings', () => {
  it('renders resource-specific title, consequence, and button copy', () => {
    renderDelete(createAdapter());

    expect(screen.getByText('Delete this project')).toBeInTheDocument();
    expect(screen.getByText('All project data will be permanently deleted.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete project' })).toBeInTheDocument();
  });

  it('keeps blank and wrong confirmation phrases from submitting', async () => {
    const user = userEvent.setup();
    const adapter = createAdapter();
    renderDelete(adapter);
    const input = await reveal(user);
    const submit = screen.getByRole('button', { name: 'Permanently delete' });

    expect(submit).toBeDisabled();
    await user.type(input, 'Delete Other');
    expect(submit).toBeDisabled();
    await user.keyboard('{Enter}');

    expect(adapter.deleteResource).not.toHaveBeenCalled();
  });

  it('submits only the exact, case-sensitive phrase', async () => {
    const user = userEvent.setup();
    const adapter = createAdapter();
    renderDelete(adapter);
    const input = await reveal(user);

    await user.type(input, 'Delete Roadmap');
    await user.click(screen.getByRole('button', { name: 'Permanently delete' }));

    await waitFor(() =>
      expect(adapter.deleteResource).toHaveBeenCalledWith('Delete Roadmap'),
    );
  });

  it('uses the latest live Query-derived name after a rename', async () => {
    const user = userEvent.setup();
    const adapter = createAdapter();

    function LiveNameHarness() {
      const [name, setName] = useState('Roadmap');
      return (
        <>
          <button onClick={() => setName('Delivery')}>Rename resource</button>
          <ConfirmedDeleteSettings adapter={{ ...adapter, resourceName: name }} />
        </>
      );
    }

    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <LiveNameHarness />
      </QueryClientProvider>,
    );
    const input = await reveal(user);
    await user.type(input, 'Delete Roadmap');
    expect(screen.getByRole('button', { name: 'Permanently delete' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Rename resource' }));

    expect(screen.getByText('Delete Delivery')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Permanently delete' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'Delete Delivery');
    await user.click(screen.getByRole('button', { name: 'Permanently delete' }));

    await waitFor(() =>
      expect(adapter.deleteResource).toHaveBeenCalledWith('Delete Delivery'),
    );
  });

  it('locks confirmation controls while deletion and follow-up work are pending', async () => {
    const user = userEvent.setup();
    const deletion = deferred<void>();
    const refresh = deferred<void>();
    const adapter = createAdapter({
      deleteResource: vi.fn(() => deletion.promise),
      refreshAfterDelete: vi.fn(() => refresh.promise),
    });
    renderDelete(adapter);
    const input = await reveal(user);
    await user.type(input, 'Delete Roadmap');
    await user.click(screen.getByRole('button', { name: 'Permanently delete' }));

    expect(await screen.findByRole('button', { name: 'Deleting project...' })).toBeDisabled();
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    deletion.resolve();
    await waitFor(() => expect(adapter.refreshAfterDelete).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Deleting project...' })).toBeDisabled();

    refresh.resolve();
    await waitFor(() => expect(adapter.onDeleted).toHaveBeenCalledOnce());
  });

  it('orders deletion, explicit cache refresh, then destination handling', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const adapter = createAdapter({
      deleteResource: vi.fn(async () => {
        order.push('delete');
      }),
      refreshAfterDelete: vi.fn(async () => {
        order.push('refresh');
      }),
      onDeleted: vi.fn(async () => {
        order.push('destination');
      }),
    });
    renderDelete(adapter);
    await user.type(await reveal(user), 'Delete Roadmap');
    await user.click(screen.getByRole('button', { name: 'Permanently delete' }));

    await waitFor(() => expect(order).toEqual(['delete', 'refresh', 'destination']));
  });

  it('shows structured API errors and does not refresh or navigate on failure', async () => {
    const user = userEvent.setup();
    const adapter = createAdapter({
      deleteResource: vi
        .fn()
        .mockRejectedValue({ parsedMessage: 'Project has active jobs' }),
    });
    renderDelete(adapter);
    await user.type(await reveal(user), 'Delete Roadmap');
    await user.click(screen.getByRole('button', { name: 'Permanently delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Project has active jobs');
    expect(adapter.refreshAfterDelete).not.toHaveBeenCalled();
    expect(adapter.onDeleted).not.toHaveBeenCalled();
  });

  it('cancel hides confirmation and clears both input and mutation error', async () => {
    const user = userEvent.setup();
    const adapter = createAdapter({
      deleteResource: vi.fn().mockRejectedValue(new Error('network failed')),
    });
    renderDelete(adapter);
    await user.type(await reveal(user), 'Delete Roadmap');
    await user.click(screen.getByRole('button', { name: 'Permanently delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to delete project');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Confirmation' })).not.toBeInTheDocument();

    const input = await reveal(user);
    expect(input).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
