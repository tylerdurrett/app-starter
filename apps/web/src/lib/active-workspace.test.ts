import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// active-workspace imports getLastActiveProject from ./projects, which pulls in
// ./api and its top-level VITE_SERVER_URL check. Mock ./api so the module loads
// under the node test env (same pattern as projects.test.ts). These tests cover
// the pure comparator and storage only — no network is exercised.
vi.mock('./api', () => ({ apiFetch: vi.fn() }));

import {
  activeContextAgreesWithServer,
  clearActiveContext,
  parseProjectSlug,
  parseWorkspaceSlug,
  readActiveContext,
  resolveActiveContext,
  writeActiveContext,
  type StoredActiveContext,
} from './active-workspace';
import type { Project } from './projects';

describe('parseWorkspaceSlug', () => {
  it('resolves the workspace slug from a nested workspace path', () => {
    expect(parseWorkspaceSlug('/w/acme')).toBe('acme');
  });

  it('resolves the workspace slug from a nested project path', () => {
    expect(parseWorkspaceSlug('/w/acme/p/proj')).toBe('acme');
  });

  it('resolves the workspace slug from deeper nested paths (settings)', () => {
    expect(parseWorkspaceSlug('/w/acme/p/proj/settings')).toBe('acme');
  });

  it('returns null for the legacy flat project path', () => {
    expect(parseWorkspaceSlug('/p/proj')).toBeNull();
  });

  it('returns null for unrelated paths', () => {
    expect(parseWorkspaceSlug('/onboarding/create-workspace')).toBeNull();
    expect(parseWorkspaceSlug('/')).toBeNull();
  });
});

describe('parseProjectSlug', () => {
  it('resolves the project slug from a nested project path', () => {
    expect(parseProjectSlug('/w/acme/p/proj')).toBe('proj');
  });

  it('resolves the project slug from deeper nested paths (settings)', () => {
    expect(parseProjectSlug('/w/acme/p/proj/settings')).toBe('proj');
  });

  it('yields no project match for the legacy flat /p/:slug shape', () => {
    // Proves flat routes no longer resolve at the parse layer (ADR-0009).
    expect(parseProjectSlug('/p/proj')).toBeNull();
  });

  it('yields no project match for a workspace-only path', () => {
    expect(parseProjectSlug('/w/acme')).toBeNull();
  });

  it('returns null for unrelated paths', () => {
    expect(parseProjectSlug('/onboarding/create-workspace')).toBeNull();
  });
});

describe('resolveActiveContext', () => {
  const cachedA: StoredActiveContext = {
    workspaceSlug: 'workspace-A',
    projectSlug: 'reports',
    projectId: 'proj-a1',
  };

  it('never crosses a URL workspace with a cached project (AC4 drift)', () => {
    // On /w/workspace-B/settings with (workspace-A, reports) remembered from a
    // prior session: the workspace is B, but the project unit stays A's — the
    // pair must never become (workspace-B, reports).
    const resolved = resolveActiveContext({
      urlWorkspaceSlug: 'workspace-B',
      urlProjectSlug: null,
      urlProjectId: null,
      cached: cachedA,
    });

    expect(resolved.workspaceSlug).toBe('workspace-B');
    expect(resolved.fromUrl).toBe(true);
    // The coherent project unit belongs to workspace-A, not the URL's B.
    expect(resolved.projectWorkspaceSlug).toBe('workspace-A');
    expect(resolved.projectSlug).toBe('reports');
    expect(resolved.projectId).toBe('proj-a1');
    // The forbidden cross-workspace pairing is impossible.
    const isCrossPair =
      resolved.projectWorkspaceSlug === 'workspace-B' && resolved.projectSlug === 'reports';
    expect(isCrossPair).toBe(false);
  });

  it('treats a full URL (workspace, project) pair as authoritative over the cache', () => {
    const resolved = resolveActiveContext({
      urlWorkspaceSlug: 'workspace-B',
      urlProjectSlug: 'dashboards',
      urlProjectId: 'proj-b7',
      cached: cachedA,
    });

    expect(resolved.workspaceSlug).toBe('workspace-B');
    expect(resolved.fromUrl).toBe(true);
    expect(resolved.projectWorkspaceSlug).toBe('workspace-B');
    expect(resolved.projectSlug).toBe('dashboards');
    expect(resolved.projectId).toBe('proj-b7');
  });

  it('falls back to the cached unit whole on a project-less route with no URL workspace', () => {
    const resolved = resolveActiveContext({
      urlWorkspaceSlug: null,
      urlProjectSlug: null,
      urlProjectId: null,
      cached: cachedA,
    });

    expect(resolved.workspaceSlug).toBe('workspace-A');
    expect(resolved.fromUrl).toBe(false);
    expect(resolved.projectWorkspaceSlug).toBe('workspace-A');
    expect(resolved.projectSlug).toBe('reports');
    expect(resolved.projectId).toBe('proj-a1');
  });

  it('yields an empty unit when there is no URL and no cache', () => {
    const resolved = resolveActiveContext({
      urlWorkspaceSlug: null,
      urlProjectSlug: null,
      urlProjectId: null,
      cached: null,
    });

    expect(resolved).toEqual({
      workspaceSlug: null,
      fromUrl: false,
      projectWorkspaceSlug: null,
      projectSlug: null,
      projectId: null,
    });
  });
});

describe('activeContextAgreesWithServer', () => {
  const cached: StoredActiveContext = {
    workspaceSlug: 'workspace-A',
    projectSlug: 'reports',
    projectId: 'proj-a1',
  };

  function serverProject(overrides: Partial<Project> = {}): Project {
    return {
      id: 'proj-a1',
      name: 'Reports',
      slug: 'reports',
      workspaceId: 'ws-a',
      workspaceSlug: 'workspace-A',
      workspaceName: 'Workspace A',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('flags the hint stale when the server returns null (deleted / access revoked)', () => {
    // The revoked-access acceptance criterion: server authority says no
    // last-active project, so the cached hint must be cleared, not painted.
    expect(activeContextAgreesWithServer(cached, null)).toBe(false);
  });

  it('keeps the hint when the server id matches the cached projectId', () => {
    // A moved/renamed project keeps its id — id match wins even if slugs shift.
    expect(
      activeContextAgreesWithServer(cached, serverProject({ slug: 'renamed', workspaceSlug: 'workspace-A' })),
    ).toBe(true);
  });

  it('flags the hint stale when the server id disagrees with the cached projectId', () => {
    expect(activeContextAgreesWithServer(cached, serverProject({ id: 'proj-other' }))).toBe(false);
  });

  it('compares the (workspaceSlug, projectSlug) pair when the cache carries no id', () => {
    const noId: StoredActiveContext = { workspaceSlug: 'workspace-A', projectSlug: 'reports', projectId: null };
    expect(activeContextAgreesWithServer(noId, serverProject({ id: 'anything' }))).toBe(true);
  });

  it('flags the hint stale when the pair disagrees and the cache carries no id', () => {
    const noId: StoredActiveContext = { workspaceSlug: 'workspace-A', projectSlug: 'reports', projectId: null };
    // Same project slug but a different workspace — never treat it as a match
    // (ADR-0009: slugs are per-workspace, so this is a different project).
    expect(activeContextAgreesWithServer(noId, serverProject({ workspaceSlug: 'workspace-B' }))).toBe(false);
    expect(activeContextAgreesWithServer(noId, serverProject({ slug: 'dashboards' }))).toBe(false);
  });
});

describe('active-context storage round-trip', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
  });

  afterEach(() => {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWindow;
  });

  it('writes and reads back the single unit including projectId', () => {
    const unit: StoredActiveContext = {
      workspaceSlug: 'workspace-A',
      projectSlug: 'reports',
      projectId: 'proj-a1',
    };
    writeActiveContext(unit);
    expect(readActiveContext()).toEqual(unit);
  });

  it('round-trips a null projectId', () => {
    const unit: StoredActiveContext = {
      workspaceSlug: 'workspace-A',
      projectSlug: 'reports',
      projectId: null,
    };
    writeActiveContext(unit);
    expect(readActiveContext()).toEqual(unit);
  });

  it('returns null for absent storage', () => {
    expect(readActiveContext()).toBeNull();
  });

  it('clearActiveContext removes the stored unit so a revoked hint stops painting', () => {
    const unit: StoredActiveContext = {
      workspaceSlug: 'workspace-A',
      projectSlug: 'reports',
      projectId: 'proj-a1',
    };
    writeActiveContext(unit);
    expect(readActiveContext()).toEqual(unit);

    clearActiveContext();
    expect(readActiveContext()).toBeNull();
  });

  it('returns null for malformed / partial JSON instead of throwing', () => {
    window.localStorage.setItem('activeContext', 'not json{');
    expect(readActiveContext()).toBeNull();
    window.localStorage.setItem('activeContext', JSON.stringify({ workspaceSlug: 'only-ws' }));
    expect(readActiveContext()).toBeNull();
  });
});
