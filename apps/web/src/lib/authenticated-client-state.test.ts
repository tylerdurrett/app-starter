import { QueryClient } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let clearAuthenticatedClientState: typeof import('./authenticated-client-state')['clearAuthenticatedClientState'];
let establishAuthenticatedClientOwner: typeof import('./authenticated-client-state')['establishAuthenticatedClientOwner'];
let readActiveContext: typeof import('./active-workspace')['readActiveContext'];
let writeActiveContext: typeof import('./active-workspace')['writeActiveContext'];

beforeAll(async () => {
  vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
  ({ clearAuthenticatedClientState, establishAuthenticatedClientOwner } = await import(
    './authenticated-client-state'
  ));
  ({ readActiveContext, writeActiveContext } = await import('./active-workspace'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clearAuthenticatedClientState', () => {
  it('evicts all queries and the persisted active context when a session is absent', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(['private', 'user-a'], { secret: true });
    writeActiveContext({ workspaceSlug: 'a', projectSlug: 'private', projectId: 'p-a' });

    clearAuthenticatedClientState(queryClient);

    expect(queryClient.getQueryCache().findAll()).toEqual([]);
    expect(readActiveContext()).toBeNull();
  });

  it('evicts a previous owner once before adopting a different session', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, 'clear');
    establishAuthenticatedClientOwner(queryClient, 'user-a');
    queryClient.setQueryData(['private', 'user-a'], { secret: true });
    writeActiveContext({ workspaceSlug: 'a', projectSlug: 'private', projectId: 'p-a' });

    establishAuthenticatedClientOwner(queryClient, 'user-b');
    establishAuthenticatedClientOwner(queryClient, 'user-b');

    expect(clear).toHaveBeenCalledOnce();
    expect(queryClient.getQueryCache().findAll()).toEqual([]);
    expect(readActiveContext()).toBeNull();
  });

  it('keeps state when the observed session still has the same owner', () => {
    const queryClient = new QueryClient();
    establishAuthenticatedClientOwner(queryClient, 'user-a');
    queryClient.setQueryData(['private', 'user-a'], { secret: true });

    establishAuthenticatedClientOwner(queryClient, 'user-a');

    expect(queryClient.getQueryData(['private', 'user-a'])).toEqual({ secret: true });
  });

  it('evicts an authenticated owner only once when the session becomes absent', () => {
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, 'clear');
    establishAuthenticatedClientOwner(queryClient, 'user-a');
    queryClient.setQueryData(['private', 'user-a'], { secret: true });

    establishAuthenticatedClientOwner(queryClient, null);
    establishAuthenticatedClientOwner(queryClient, null);

    expect(clear).toHaveBeenCalledOnce();
    expect(queryClient.getQueryCache().findAll()).toEqual([]);
  });

  it('lets the next boundary adopt an owner after an explicit transition clear', () => {
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, 'clear');
    establishAuthenticatedClientOwner(queryClient, 'user-a');

    clearAuthenticatedClientState(queryClient);
    establishAuthenticatedClientOwner(queryClient, 'user-b');

    expect(clear).toHaveBeenCalledOnce();
  });

  it('clears an ownerless persisted hint once when the first session is absent', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, 'clear');
    writeActiveContext({ workspaceSlug: 'a', projectSlug: 'private', projectId: 'p-a' });

    establishAuthenticatedClientOwner(queryClient, null);
    establishAuthenticatedClientOwner(queryClient, null);

    expect(clear).toHaveBeenCalledOnce();
    expect(readActiveContext()).toBeNull();
  });

  it('records an explicit sign-out clear as absent', () => {
    const queryClient = new QueryClient();
    const clear = vi.spyOn(queryClient, 'clear');
    establishAuthenticatedClientOwner(queryClient, 'user-a');

    clearAuthenticatedClientState(queryClient, null);
    establishAuthenticatedClientOwner(queryClient, null);

    expect(clear).toHaveBeenCalledOnce();
  });
});
