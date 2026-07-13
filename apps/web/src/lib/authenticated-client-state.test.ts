import { QueryClient } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let clearAuthenticatedClientState: typeof import('./authenticated-client-state')['clearAuthenticatedClientState'];
let readActiveContext: typeof import('./active-workspace')['readActiveContext'];
let writeActiveContext: typeof import('./active-workspace')['writeActiveContext'];

beforeAll(async () => {
  vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
  ({ clearAuthenticatedClientState } = await import('./authenticated-client-state'));
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
});
