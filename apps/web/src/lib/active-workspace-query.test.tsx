import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from './projects';

const mocks = vi.hoisted(() => ({
  pathname: '/account',
  getLastActiveProject: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useRouterState: () => ({ location: { pathname: mocks.pathname } }),
}));

vi.mock('./projects', async (importOriginal) => {
  const original = await importOriginal<typeof import('./projects')>();
  return {
    ...original,
    getLastActiveProject: mocks.getLastActiveProject,
    getProject: mocks.getProject,
  };
});

import { readActiveContext, useActiveContext, writeActiveContext } from './active-workspace';
import {
  lastActiveProjectValidationQueryOptions,
  projectQueryOptions,
} from './project-queries';

const hintA = {
  workspaceSlug: 'workspace-a',
  projectSlug: 'shared',
  projectId: 'project-a',
};
const hintB = {
  workspaceSlug: 'workspace-b',
  projectSlug: 'shared',
  projectId: 'project-b',
};

function project(hint: typeof hintA, overrides: Partial<Project> = {}): Project {
  return {
    id: hint.projectId,
    name: hint.projectSlug,
    slug: hint.projectSlug,
    workspaceId: `id-${hint.workspaceSlug}`,
    workspaceSlug: hint.workspaceSlug,
    workspaceName: hint.workspaceSlug,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createClient(staleTime = Infinity) {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime } },
  });
}

function ContextProbe() {
  const active = useActiveContext();
  return <output>{JSON.stringify(active)}</output>;
}

function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function readProbe() {
  return JSON.parse(screen.getByRole('status').textContent ?? '{}') as ReturnType<
    typeof useActiveContext
  >;
}

describe('useActiveContext Query reconciliation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.pathname = '/account';
    mocks.getLastActiveProject.mockReset();
    mocks.getProject.mockReset();
  });

  it('isolates A and B verdicts by the full coherent hint', () => {
    writeActiveContext(hintB);
    const pendingB = deferred<Project | null>();
    mocks.getLastActiveProject.mockReturnValue(pendingB.promise);
    const client = createClient();
    client.setQueryData(
      lastActiveProjectValidationQueryOptions(hintA).queryKey,
      project(hintA, { id: 'different-a' }),
    );

    render(
      <Providers client={client}>
        <ContextProbe />
      </Providers>,
    );

    expect(readProbe().projectId).toBe('project-b');
    expect(readActiveContext()).toEqual(hintB);
  });

  it('replaces old A with loader-seeded B and preserves B on a project-less route', async () => {
    writeActiveContext(hintA);
    const client = createClient();
    const loadedB = { ...project(hintB), role: 'owner' as const };
    client.setQueryData(projectQueryOptions('workspace-b', 'shared').queryKey, loadedB);
    client.setQueryData(lastActiveProjectValidationQueryOptions(hintB).queryKey, loadedB);
    mocks.pathname = '/w/workspace-b/p/shared';

    const view = render(
      <Providers client={client}>
        <ContextProbe />
      </Providers>,
    );
    await waitFor(() => expect(readActiveContext()).toEqual(hintB));

    mocks.pathname = '/account';
    view.rerender(
      <Providers client={client}>
        <ContextProbe />
      </Providers>,
    );

    expect(readProbe().projectId).toBe('project-b');
    expect(readActiveContext()).toEqual(hintB);
    expect(mocks.getLastActiveProject).not.toHaveBeenCalled();
  });

  it.each([
    ['matching', hintA, project(hintA), 'project-a'],
    ['null', hintA, null, null],
    [
      'different project in the same workspace',
      hintA,
      project(hintA, { id: 'project-different', slug: 'different' }),
      null,
    ],
    [
      'same slug in another workspace when the hint has no id',
      { ...hintA, projectId: null },
      project(hintB),
      null,
    ],
  ] as const)(
    'handles a settled %s server verdict',
    async (_case, cachedHint, verdict, expectedId) => {
      writeActiveContext(cachedHint);
      mocks.getLastActiveProject.mockResolvedValue(verdict);

      render(
        <Providers client={createClient(0)}>
          <ContextProbe />
        </Providers>,
      );

      await waitFor(() => expect(readProbe().projectId).toBe(expectedId));
      await waitFor(() =>
        expect(readActiveContext()).toEqual(expectedId == null ? null : cachedHint),
      );
    },
  );

  it('preserves the hint while its initial validation is pending', () => {
    writeActiveContext(hintA);
    const pending = deferred<Project | null>();
    mocks.getLastActiveProject.mockReturnValue(pending.promise);

    render(
      <Providers client={createClient(0)}>
        <ContextProbe />
      </Providers>,
    );

    expect(readProbe().projectId).toBe('project-a');
    expect(readActiveContext()).toEqual(hintA);
  });

  it('preserves the hint during a refetch even when prior data disagrees', () => {
    writeActiveContext(hintA);
    const pending = deferred<Project | null>();
    mocks.getLastActiveProject.mockReturnValue(pending.promise);
    const client = createClient(0);
    client.setQueryData(
      lastActiveProjectValidationQueryOptions(hintA).queryKey,
      project(hintB),
    );

    render(
      <Providers client={client}>
        <ContextProbe />
      </Providers>,
    );

    expect(readProbe().projectId).toBe('project-a');
    expect(readActiveContext()).toEqual(hintA);
  });

  it('preserves the hint after a failed refetch with prior data retained', async () => {
    writeActiveContext(hintA);
    const failed = deferred<Project | null>();
    mocks.getLastActiveProject.mockReturnValue(failed.promise);
    const client = createClient(0);
    client.setQueryData(
      lastActiveProjectValidationQueryOptions(hintA).queryKey,
      project(hintB),
    );

    render(
      <Providers client={client}>
        <ContextProbe />
      </Providers>,
    );
    await act(async () => failed.reject(new Error('offline')));

    await waitFor(() =>
      expect(
        client.getQueryState(lastActiveProjectValidationQueryOptions(hintA).queryKey)?.status,
      ).toBe('error'),
    );
    expect(readProbe().projectId).toBe('project-a');
    expect(readActiveContext()).toEqual(hintA);
  });

  it('treats malformed storage as no hint and does not validate it', () => {
    window.localStorage.setItem('activeContext', '{bad json');

    render(
      <Providers client={createClient()}>
        <ContextProbe />
      </Providers>,
    );

    expect(readProbe().projectId).toBeNull();
    expect(mocks.getLastActiveProject).not.toHaveBeenCalled();
  });
});
