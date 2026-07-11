import { afterEach, describe, expect, it, vi } from 'vitest';
import { maskedIntegrationSchema, testIntegrationResultSchema } from '@repo/shared';

// Well-formed reference payloads matching the shared API contract.
const validIntegration = {
  id: 'int1',
  workspaceId: 'w1',
  type: 'slack',
  name: 'My Slack',
  status: 'active',
  config: { channel: '#general' },
  credentialsReadable: true,
  lastTestedAt: '2026-01-01T00:00:00.000Z',
  lastTestError: null,
  createdByUserId: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const validTestResult = {
  status: 'active',
  lastTestedAt: '2026-01-01T00:00:00.000Z',
  info: { team: 'Acme' },
};

// A schema drift must fail loudly, never silently. Cover the MaskedIntegration
// shape AND the TestIntegrationResult shape so a mismatch in either surfaces.
describe('integration contract schemas', () => {
  it('accept the well-formed reference payloads', () => {
    expect(() => maskedIntegrationSchema.parse(validIntegration)).not.toThrow();
    expect(() => testIntegrationResultSchema.parse(validTestResult)).not.toThrow();
  });

  it('throws on a MaskedIntegration missing a required field', () => {
    const { credentialsReadable: _omit, ...bad } = validIntegration;
    expect(() => maskedIntegrationSchema.parse(bad)).toThrow();
  });

  it('throws on a MaskedIntegration with an out-of-range status', () => {
    expect(() => maskedIntegrationSchema.parse({ ...validIntegration, status: 'disabled' })).toThrow();
  });

  it('throws on a MaskedIntegration with an out-of-range type', () => {
    expect(() => maskedIntegrationSchema.parse({ ...validIntegration, type: 'discord' })).toThrow();
  });

  it('throws on a TestIntegrationResult with an out-of-range status', () => {
    expect(() => testIntegrationResultSchema.parse({ ...validTestResult, status: 'disabled' })).toThrow();
  });
});

// Prove the drift throws through the real fetch boundary (apiFetchParsed), not
// just when calling the schema directly.
describe('apiFetchParsed boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadLibReturning(body: unknown) {
    vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => body,
      }),
    );
    vi.resetModules();
    return import('./integrations');
  }

  it('rejects when the server returns a malformed MaskedIntegration', async () => {
    const { listIntegrations } = await loadLibReturning([{ ...validIntegration, status: 'disabled' }]);
    await expect(listIntegrations('acme')).rejects.toThrow();
  });

  it('rejects when the server returns a malformed TestIntegrationResult', async () => {
    const { testIntegration } = await loadLibReturning({ ...validTestResult, status: 'disabled' });
    await expect(testIntegration('acme', 'int1')).rejects.toThrow();
  });

  it('resolves when the server returns a well-formed MaskedIntegration', async () => {
    const { getIntegration } = await loadLibReturning(validIntegration);
    await expect(getIntegration('acme', 'int1')).resolves.toMatchObject({
      id: 'int1',
      type: 'slack',
      status: 'active',
    });
  });
});

// The integrations list/detail routes and the Slack SettingsComponent read
// server state through TanStack Query keyed by the shared `queryKeys` factory,
// and their write mutations invalidate those same keys so the UI reflects the
// change without a manual reload (ADR-0007). These tests drive the real data
// helpers against a mini in-memory server through a live QueryClient +
// QueryObserver so the read key, the mutation, and the invalidation key all
// have to agree — exactly the wiring the components depend on.
describe('integration query/mutation invalidation wiring', () => {
  const slug = 'acme';
  const intA = { ...validIntegration, id: 'int-a', name: 'A' };
  const intB = { ...validIntegration, id: 'int-b', name: 'B' };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function jsonResponse(body: unknown, status = 200) {
    return {
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  // A mutable in-memory store standing in for the server, routed by URL+method,
  // so a DELETE/PATCH actually mutates what a subsequent GET (a refetch) sees.
  async function setup(initial: typeof validIntegration[]) {
    const store = { integrations: initial.map((i) => ({ ...i })) };
    const listPath = `/api/workspaces/${slug}/integrations`;
    const fetchMock = vi.fn(async (input: unknown, options?: RequestInit) => {
      const url = new URL(String(input));
      const method = (options?.method ?? 'GET').toUpperCase();
      const path = url.pathname;

      const testMatch = path.match(/\/integrations\/([^/]+)\/test$/);
      if (testMatch && method === 'POST') {
        return jsonResponse({
          status: 'active',
          lastTestedAt: '2026-02-02T00:00:00.000Z',
          info: { team: 'Acme' },
        });
      }

      if (path === listPath && method === 'GET') return jsonResponse(store.integrations);
      if (path === listPath && method === 'POST') {
        const created = { ...validIntegration, id: 'int-new' };
        store.integrations.push(created);
        return jsonResponse(created);
      }

      const detailMatch = path.match(/\/integrations\/([^/]+)$/);
      if (detailMatch) {
        const id = detailMatch[1];
        const found = store.integrations.find((i) => i.id === id);
        if (method === 'GET') {
          return found ? jsonResponse(found) : jsonResponse({ error: 'not found' }, 404);
        }
        if (method === 'PATCH') {
          const body = JSON.parse(String(options?.body ?? '{}'));
          if (found && typeof body.name === 'string') found.name = body.name;
          return jsonResponse({ ...(found ?? validIntegration), status: 'active' });
        }
        if (method === 'DELETE') {
          store.integrations = store.integrations.filter((i) => i.id !== id);
          return jsonResponse(null, 204);
        }
      }

      throw new Error(`unhandled ${method} ${path}`);
    });

    vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();

    const lib = await import('./integrations');
    const { queryKeys } = await import('./query-keys');
    const { QueryClient, QueryObserver } = await import('@tanstack/react-query');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return { store, fetchMock, lib, queryKeys, QueryClient, QueryObserver, queryClient };
  }

  it('reads and invalidations use the exact key tuples from the shared factory', async () => {
    const { queryKeys } = await setup([intA]);
    expect(queryKeys.integrations(slug)).toEqual(['integrations', 'acme']);
    expect(queryKeys.integration(slug, intA.id)).toEqual(['integration', 'acme', 'int-a']);
    // Distinct roots so invalidating the list never cascades into a detail.
    expect(queryKeys.integrations(slug)[0]).not.toBe(queryKeys.integration(slug, intA.id)[0]);
  });

  it('delete + invalidating the list key refetches the list without the deleted integration', async () => {
    const { lib, queryKeys, QueryObserver, queryClient } = await setup([intA, intB]);
    const listQueryFn = vi.fn(() => lib.listIntegrations(slug));
    const observer = new QueryObserver(queryClient, {
      queryKey: queryKeys.integrations(slug),
      queryFn: listQueryFn,
    });
    const unsub = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    expect(observer.getCurrentResult().data).toHaveLength(2);
    const before = listQueryFn.mock.calls.length;

    await lib.deleteIntegration(slug, intA.id);
    await queryClient.invalidateQueries({ queryKey: queryKeys.integrations(slug) });

    expect(listQueryFn.mock.calls.length).toBeGreaterThan(before);
    expect(observer.getCurrentResult().data?.map((i) => i.id)).toEqual(['int-b']);

    unsub();
    queryClient.clear();
  });

  it('edit-mode invalidation of both keys refetches the detail and the list, leaving a sibling detail untouched', async () => {
    const { lib, queryKeys, QueryObserver, queryClient } = await setup([intA, intB]);

    const detailFn = vi.fn(() => lib.getIntegration(slug, intA.id));
    const listFn = vi.fn(() => lib.listIntegrations(slug));
    const siblingFn = vi.fn(() => lib.getIntegration(slug, intB.id));

    const detail = new QueryObserver(queryClient, {
      queryKey: queryKeys.integration(slug, intA.id),
      queryFn: detailFn,
    });
    const list = new QueryObserver(queryClient, {
      queryKey: queryKeys.integrations(slug),
      queryFn: listFn,
    });
    const sibling = new QueryObserver(queryClient, {
      queryKey: queryKeys.integration(slug, intB.id),
      queryFn: siblingFn,
    });
    const subs = [detail, list, sibling].map((o) => o.subscribe(() => {}));
    await vi.waitFor(() => {
      expect(detail.getCurrentResult().isSuccess).toBe(true);
      expect(list.getCurrentResult().isSuccess).toBe(true);
      expect(sibling.getCurrentResult().isSuccess).toBe(true);
    });
    const detailBefore = detailFn.mock.calls.length;
    const listBefore = listFn.mock.calls.length;
    const siblingBefore = siblingFn.mock.calls.length;

    await lib.updateIntegration(slug, intA.id, { name: 'A2' });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.integration(slug, intA.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.integrations(slug) }),
    ]);

    // Both the detail and list refetched and reflect the mutated name...
    expect(detailFn.mock.calls.length).toBeGreaterThan(detailBefore);
    expect(listFn.mock.calls.length).toBeGreaterThan(listBefore);
    expect(detail.getCurrentResult().data?.name).toBe('A2');
    expect(list.getCurrentResult().data?.find((i) => i.id === intA.id)?.name).toBe('A2');
    // ...while the unrelated sibling detail was not disturbed.
    expect(siblingFn.mock.calls.length).toBe(siblingBefore);

    subs.forEach((u) => u());
    queryClient.clear();
  });
});
