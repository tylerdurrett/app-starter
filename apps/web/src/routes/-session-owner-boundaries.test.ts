import { QueryClient } from '@tanstack/react-query';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveProject: vi.fn(),
}));

vi.mock('../lib/auth-client', () => ({
  authClient: { getSession: mocks.getSession },
}));

vi.mock('../lib/project-resolver', () => ({
  resolveProject: mocks.resolveProject,
}));

vi.mock('../components/nav-rail', () => ({
  NavRail: () => null,
}));

vi.mock('../components/authenticated-client-boundary', () => ({
  AuthenticatedClientBoundary: ({ children }: { children: unknown }) => children,
}));

type Boundary = (options: {
  context: { queryClient: QueryClient };
  search?: { redirectTo?: string };
}) => Promise<unknown>;

let appBoundary: Boundary;
let authBoundary: Boundary;
let establishAuthenticatedClientOwner: typeof import('../lib/authenticated-client-state')['establishAuthenticatedClientOwner'];
let readActiveContext: typeof import('../lib/active-workspace')['readActiveContext'];
let writeActiveContext: typeof import('../lib/active-workspace')['writeActiveContext'];

beforeAll(async () => {
  vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
  ({ establishAuthenticatedClientOwner } = await import('../lib/authenticated-client-state'));
  ({ readActiveContext, writeActiveContext } = await import('../lib/active-workspace'));
  const [{ Route: AppRoute }, { Route: AuthRoute }] = await Promise.all([
    import('./_app'),
    import('./_auth'),
  ]);
  appBoundary = AppRoute.options.beforeLoad as unknown as Boundary;
  authBoundary = AuthRoute.options.beforeLoad as unknown as Boundary;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function setupUserAState() {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await establishAuthenticatedClientOwner(queryClient, 'user-a');
  queryClient.setQueryData(['private', 'user-a'], { secret: true });
  writeActiveContext({ workspaceSlug: 'a', projectSlug: 'private', projectId: 'p-a' });
  return queryClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('getSession route ownership boundaries', () => {
  it('evicts user A before the auth resolver reads private state for user B', async () => {
    const queryClient = await setupUserAState();
    const order: string[] = [];
    vi.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => void order.push('cancel'));
    vi.spyOn(queryClient, 'clear').mockImplementation(() => {
      order.push('clear');
      queryClient.getQueryCache().clear();
      queryClient.getMutationCache().clear();
    });
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user-b' } } });
    mocks.resolveProject.mockImplementation(async (client: QueryClient) => {
      expect(order).toEqual(['cancel', 'clear']);
      expect(client.getQueryData(['private', 'user-a'])).toBeUndefined();
      expect(readActiveContext()).toBeNull();
      return { to: '/onboarding/create-workspace' };
    });

    await expect(authBoundary({ context: { queryClient }, search: {} })).rejects.toBeDefined();

    expect(mocks.resolveProject).toHaveBeenCalledOnce();
  });

  it('evicts user A at the app guard before user B can use private queries', async () => {
    const queryClient = await setupUserAState();
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user-b' } } });

    await appBoundary({ context: { queryClient } });
    const userBQuery = vi.fn(async () => {
      expect(queryClient.getQueryData(['private', 'user-a'])).toBeUndefined();
      expect(readActiveContext()).toBeNull();
      return { workspaceSlug: 'b' };
    });
    await queryClient.fetchQuery({ queryKey: ['private', 'user-b'], queryFn: userBQuery });

    expect(userBQuery).toHaveBeenCalledOnce();
  });

  it('keeps cached private state when the app guard observes the same user', async () => {
    const queryClient = await setupUserAState();
    const clear = vi.spyOn(queryClient, 'clear');
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user-a' } } });

    await appBoundary({ context: { queryClient } });

    expect(clear).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['private', 'user-a'])).toEqual({ secret: true });
    expect(readActiveContext()).not.toBeNull();
  });

  it('lets the auth resolver reuse private state for the same user', async () => {
    const queryClient = await setupUserAState();
    const clear = vi.spyOn(queryClient, 'clear');
    mocks.getSession.mockResolvedValue({ data: { user: { id: 'user-a' } } });
    mocks.resolveProject.mockImplementation(async (client: QueryClient) => {
      expect(client.getQueryData(['private', 'user-a'])).toEqual({ secret: true });
      return { to: '/w/$workspaceSlug', params: { workspaceSlug: 'a' } };
    });

    await expect(authBoundary({ context: { queryClient }, search: {} })).rejects.toBeDefined();

    expect(clear).not.toHaveBeenCalled();
    expect(mocks.resolveProject).toHaveBeenCalledOnce();
  });

  it('prevents an older A response from resolving after a newer B boundary wins', async () => {
    const queryClient = await setupUserAState();
    let resolveOlder!: (value: { data: { user: { id: string } } }) => void;
    let resolveNewer!: (value: { data: { user: { id: string } } }) => void;
    mocks.getSession
      .mockImplementationOnce(() => new Promise((resolve) => (resolveOlder = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveNewer = resolve)));
    mocks.resolveProject.mockImplementation(async (client: QueryClient) => {
      expect(client.getQueryData(['private', 'user-a'])).toBeUndefined();
      return { to: '/onboarding/create-workspace' };
    });

    const olderAuthBoundary = authBoundary({ context: { queryClient }, search: {} });
    const newerAppBoundary = appBoundary({ context: { queryClient } });
    resolveNewer({ data: { user: { id: 'user-b' } } });
    await newerAppBoundary;
    resolveOlder({ data: { user: { id: 'user-a' } } });
    await expect(olderAuthBoundary).rejects.toBeDefined();

    expect(mocks.resolveProject).toHaveBeenCalledOnce();
  });
});
