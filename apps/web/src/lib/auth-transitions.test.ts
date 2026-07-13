import { QueryClient } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let completeLoginTransition: typeof import('./auth-transitions')['completeLoginTransition'];
let completeSignOutTransition: typeof import('./auth-transitions')['completeSignOutTransition'];
let readActiveContext: typeof import('./active-workspace')['readActiveContext'];
let writeActiveContext: typeof import('./active-workspace')['writeActiveContext'];

beforeAll(async () => {
  vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
  ({ completeLoginTransition, completeSignOutTransition } = await import('./auth-transitions'));
  ({ readActiveContext, writeActiveContext } = await import('./active-workspace'));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setupPrivateState() {
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
  return queryClient;
}

describe('authenticated flow transitions', () => {
  it('clears private state before returning through the external login redirect branch', async () => {
    const queryClient = setupPrivateState();
    const navigate = vi.fn();
    const resolveDestination = vi.fn();

    await completeLoginTransition({
      queryClient,
      externalRedirect: true,
      navigate,
      resolveDestination,
    });

    expect(queryClient.getQueryCache().findAll()).toEqual([]);
    expect(readActiveContext()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(resolveDestination).not.toHaveBeenCalled();
  });

  it('clears a public invite sign-out before its reload continuation', async () => {
    const queryClient = setupPrivateState();
    const order: string[] = [];
    const signOut = vi.fn(async () => {
      order.push('sign-out');
    });
    const reload = vi.fn(() => {
      expect(queryClient.getQueryCache().findAll()).toEqual([]);
      expect(readActiveContext()).toBeNull();
      order.push('reload');
    });

    await completeSignOutTransition(queryClient, signOut, reload);

    expect(order).toEqual(['sign-out', 'reload']);
  });

  it('preserves private state when sign-out fails', async () => {
    const queryClient = setupPrivateState();
    const reload = vi.fn();

    await expect(
      completeSignOutTransition(queryClient, () => Promise.reject(new Error('failed')), reload),
    ).rejects.toThrow('failed');

    expect(queryClient.getQueryData(['private', 'user-a'])).toEqual({ secret: true });
    expect(readActiveContext()).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('preserves private state when sign-out resolves with an error response', async () => {
    const queryClient = setupPrivateState();
    const reload = vi.fn();

    await expect(
      completeSignOutTransition(
        queryClient,
        () => Promise.resolve({ error: new Error('rejected') }),
        reload,
      ),
    ).rejects.toThrow('rejected');

    expect(queryClient.getQueryData(['private', 'user-a'])).toEqual({ secret: true });
    expect(readActiveContext()).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});
