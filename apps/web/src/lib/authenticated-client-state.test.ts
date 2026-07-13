import { QueryClient } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let authenticatedClientOwnerMatches: typeof import('./authenticated-client-state')['authenticatedClientOwnerMatches'];
let authenticatedClientQueriesEnabled: typeof import('./authenticated-client-state')['authenticatedClientQueriesEnabled'];
let clearAuthenticatedClientState: typeof import('./authenticated-client-state')['clearAuthenticatedClientState'];
let establishAuthenticatedClientOwner: typeof import('./authenticated-client-state')['establishAuthenticatedClientOwner'];
let observeAuthenticatedSession: typeof import('./authenticated-client-state')['observeAuthenticatedSession'];
let readActiveContext: typeof import('./active-workspace')['readActiveContext'];
let writeActiveContext: typeof import('./active-workspace')['writeActiveContext'];

beforeAll(async () => {
  vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
  ({
    authenticatedClientOwnerMatches,
    authenticatedClientQueriesEnabled,
    clearAuthenticatedClientState,
    establishAuthenticatedClientOwner,
    observeAuthenticatedSession,
  } = await import('./authenticated-client-state'));
  ({ readActiveContext, writeActiveContext } = await import('./active-workspace'));
});

afterAll(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllGlobals());

function setupStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

function seedPrivateState(queryClient: QueryClient) {
  queryClient.setQueryData(['private', 'user-a'], { secret: true });
  writeActiveContext({ workspaceSlug: 'a', projectSlug: 'private', projectId: 'p-a' });
}

describe('authenticated client ownership', () => {
  it('cancels work before evicting queries and the persisted hint', async () => {
    setupStorage();
    const queryClient = new QueryClient();
    seedPrivateState(queryClient);
    const order: string[] = [];
    vi.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => void order.push('cancel'));
    vi.spyOn(queryClient, 'clear').mockImplementation(() => void order.push('clear'));

    await clearAuthenticatedClientState(queryClient);

    expect(order).toEqual(['cancel', 'clear']);
    expect(readActiveContext()).toBeNull();
  });

  it('evicts once before adopting a different runtime owner', async () => {
    setupStorage();
    const queryClient = new QueryClient();
    await establishAuthenticatedClientOwner(queryClient, 'user-a');
    seedPrivateState(queryClient);
    const clear = vi.spyOn(queryClient, 'clear');

    await establishAuthenticatedClientOwner(queryClient, 'user-b');
    await establishAuthenticatedClientOwner(queryClient, 'user-b');

    expect(clear).toHaveBeenCalledOnce();
    expect(queryClient.getQueryCache().findAll()).toEqual([]);
    expect(readActiveContext()).toBeNull();
  });

  it('pauses query observers for the duration of an owner transition', async () => {
    setupStorage();
    const queryClient = new QueryClient();
    await establishAuthenticatedClientOwner(queryClient, 'user-a');
    let finishCancellation!: () => void;
    vi.spyOn(queryClient, 'cancelQueries').mockReturnValue(
      new Promise<void>((resolve) => (finishCancellation = resolve)),
    );

    const transition = establishAuthenticatedClientOwner(queryClient, 'user-b');
    await Promise.resolve();
    expect(authenticatedClientQueriesEnabled(queryClient)).toBe(false);
    finishCancellation();
    await transition;

    expect(authenticatedClientQueriesEnabled(queryClient)).toBe(true);
  });

  it('preserves a reload only when durable ownership proves the same user', async () => {
    setupStorage();
    const previousClient = new QueryClient();
    await establishAuthenticatedClientOwner(previousClient, 'user-a');

    const reloadedClient = new QueryClient();
    seedPrivateState(reloadedClient);
    const clear = vi.spyOn(reloadedClient, 'clear');
    await establishAuthenticatedClientOwner(reloadedClient, 'user-a');

    expect(clear).not.toHaveBeenCalled();
    expect(reloadedClient.getQueryData(['private', 'user-a'])).toEqual({ secret: true });
    expect(readActiveContext()).not.toBeNull();
  });

  it('clears a reload whose durable owner differs', async () => {
    setupStorage();
    const previousClient = new QueryClient();
    await establishAuthenticatedClientOwner(previousClient, 'user-a');

    const reloadedClient = new QueryClient();
    seedPrivateState(reloadedClient);
    await establishAuthenticatedClientOwner(reloadedClient, 'user-b');

    expect(reloadedClient.getQueryCache().findAll()).toEqual([]);
    expect(readActiveContext()).toBeNull();
  });

  it('clears an ownerless reload instead of trusting its persisted hint', async () => {
    setupStorage();
    const queryClient = new QueryClient();
    seedPrivateState(queryClient);

    await establishAuthenticatedClientOwner(queryClient, 'user-a');

    expect(queryClient.getQueryCache().findAll()).toEqual([]);
    expect(readActiveContext()).toBeNull();
  });

  it('records explicit sign-out so repeated absent observations do not clear again', async () => {
    setupStorage();
    const queryClient = new QueryClient();
    await establishAuthenticatedClientOwner(queryClient, 'user-a');
    const clear = vi.spyOn(queryClient, 'clear');

    await clearAuthenticatedClientState(queryClient, null);
    await establishAuthenticatedClientOwner(queryClient, null);

    expect(clear).toHaveBeenCalledOnce();
    expect(authenticatedClientQueriesEnabled(queryClient)).toBe(false);
  });

  it('converges out-of-order observations on the newest-started session', async () => {
    setupStorage();
    const queryClient = new QueryClient();
    await establishAuthenticatedClientOwner(queryClient, 'user-a');
    seedPrivateState(queryClient);
    let resolveOlder!: (identity: { userId: string }) => void;
    let resolveNewer!: (identity: { userId: string }) => void;
    const older = observeAuthenticatedSession(
      queryClient,
      () => new Promise((resolve) => (resolveOlder = resolve)),
    );
    const newer = observeAuthenticatedSession(
      queryClient,
      () => new Promise((resolve) => (resolveNewer = resolve)),
    );

    resolveNewer({ userId: 'user-b' });
    await expect(newer).resolves.toEqual({ userId: 'user-b' });
    resolveOlder({ userId: 'user-a' });

    await expect(older).resolves.toEqual({ userId: 'user-b' });
    expect(authenticatedClientOwnerMatches(queryClient, 'user-b')).toBe(true);
    expect(queryClient.getQueryCache().findAll()).toEqual([]);
  });

  it('makes an explicit transition supersede an older pending observation', async () => {
    setupStorage();
    const queryClient = new QueryClient();
    await establishAuthenticatedClientOwner(queryClient, 'user-a');
    let resolveOlder!: (identity: { userId: string }) => void;
    const older = observeAuthenticatedSession(
      queryClient,
      () => new Promise((resolve) => (resolveOlder = resolve)),
    );

    await clearAuthenticatedClientState(queryClient, 'user-b');
    resolveOlder({ userId: 'user-a' });

    await expect(older).resolves.toEqual({ userId: 'user-b' });
    expect(authenticatedClientOwnerMatches(queryClient, 'user-b')).toBe(true);
  });
});
