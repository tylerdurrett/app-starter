import { useEffect, useRef, useState } from 'react';
import { useRouterState, useMatch } from '@tanstack/react-router';
import { getLastActiveProject, type Project } from './projects';

// Single coherent active-context hint. The workspace and project slugs are
// stored together as one unit so a workspace remembered in one session can
// never be paired with a project remembered in another (the cross-workspace
// drift bug). Replaces the old two-key scheme (lastActiveWorkspaceSlug +
// lastActiveProjectSlug), which wrote each half independently.
const ACTIVE_CONTEXT_KEY = 'activeContext';
const WORKSPACE_PATH_RE = /^\/w\/([^/]+)/;
const PROJECT_PATH_RE = /^\/w\/[^/]+\/p\/([^/]+)/;

/**
 * Parse the workspace slug out of a nested `/w/:workspaceSlug/...` path.
 * Returns null for any path that does not begin with the workspace segment.
 */
export function parseWorkspaceSlug(pathname: string): string | null {
  return pathname.match(WORKSPACE_PATH_RE)?.[1] ?? null;
}

/**
 * Parse the project slug out of a nested `/w/:workspaceSlug/p/:projectSlug` path.
 * Returns null for the legacy flat `/p/:projectSlug` shape — the workspace-nested
 * route is the only surface that resolves a project after ADR-0009.
 */
export function parseProjectSlug(pathname: string): string | null {
  return pathname.match(PROJECT_PATH_RE)?.[1] ?? null;
}

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage disabled (private mode, quota, etc.) — fallback just won't persist
  }
}

/**
 * The stored active-context unit: a coherent `(workspace, project)` pair, plus
 * the server `projectId` when it was known at write time. Always written whole.
 */
export type StoredActiveContext = {
  workspaceSlug: string;
  projectSlug: string;
  projectId: string | null;
};

/** Safe JSON read of the single unit. Malformed / absent / partial → null; never throws. */
export function readActiveContext(): StoredActiveContext | null {
  const raw = safeRead(ACTIVE_CONTEXT_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { workspaceSlug?: unknown }).workspaceSlug === 'string' &&
      typeof (parsed as { projectSlug?: unknown }).projectSlug === 'string'
    ) {
      const p = parsed as { workspaceSlug: string; projectSlug: string; projectId?: unknown };
      return {
        workspaceSlug: p.workspaceSlug,
        projectSlug: p.projectSlug,
        projectId: typeof p.projectId === 'string' ? p.projectId : null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** Safe JSON write of the single unit. Swallows storage errors. */
export function writeActiveContext(ctx: StoredActiveContext): void {
  safeWrite(ACTIVE_CONTEXT_KEY, JSON.stringify(ctx));
}

/** Safe removal of the single unit. Swallows storage errors. */
export function clearActiveContext(): void {
  try {
    window.localStorage.removeItem(ACTIVE_CONTEXT_KEY);
  } catch {
    // storage disabled (private mode, quota, etc.) — nothing to clear
  }
}

/**
 * Pure, React-free reconciliation of the cached hint against the server's
 * authoritative last-active project (`users.lastActiveProjectId`, re-checked
 * for membership on every read — so it is null for a deleted project or one the
 * user's access was revoked). The server answer is the sole authority: the
 * cache never overrides a disagreeing server answer.
 *
 * Returns true when the hint AGREES with the server (keep it), false when it is
 * stale and must be cleared. A null server project is always stale. Otherwise
 * disagreement prefers the id when the cache carries one; else it compares the
 * coherent `(workspaceSlug, projectSlug)` pair (never crossing workspaces).
 */
export function activeContextAgreesWithServer(
  cached: StoredActiveContext,
  serverProject: Project | null,
): boolean {
  if (serverProject == null) return false;
  if (cached.projectId != null) return cached.projectId === serverProject.id;
  return (
    cached.workspaceSlug === serverProject.workspaceSlug &&
    cached.projectSlug === serverProject.slug
  );
}

export type ResolveActiveContextInput = {
  /** Workspace slug from the current URL (parse or project loader), else null. */
  urlWorkspaceSlug: string | null;
  /** Project slug from the current URL, else null. */
  urlProjectSlug: string | null;
  /** Server projectId from the project route loader, else null. */
  urlProjectId: string | null;
  /** The remembered unit, or null. Only consulted for painting project-less routes. */
  cached: StoredActiveContext | null;
};

export type ResolvedActiveContext = {
  /** Active workspace slug: URL wins, else the remembered workspace. */
  workspaceSlug: string | null;
  /** True when `workspaceSlug` came from the current URL, not the cache. */
  fromUrl: boolean;
  /**
   * Coherent last-active project unit. `projectWorkspaceSlug`, `projectSlug` and
   * `projectId` ALWAYS originate from the same source — a full URL pair, or the
   * cached pair — never a URL workspace crossed with a cached project.
   */
  projectWorkspaceSlug: string | null;
  projectSlug: string | null;
  projectId: string | null;
};

/**
 * Pure, React-free resolver for the active context. A full URL `(workspace,
 * project)` pair is authoritative and drives the project unit; on any other
 * route the cached unit (itself always stored coherent) drives the project
 * unit. The URL workspace is never paired with the cached project — that
 * pairing is exactly the cross-workspace drift bug this task removes.
 */
export function resolveActiveContext(input: ResolveActiveContextInput): ResolvedActiveContext {
  const { urlWorkspaceSlug, urlProjectSlug, urlProjectId, cached } = input;

  const workspaceSlug = urlWorkspaceSlug ?? cached?.workspaceSlug ?? null;
  const fromUrl = urlWorkspaceSlug != null;

  if (urlWorkspaceSlug != null && urlProjectSlug != null) {
    return {
      workspaceSlug,
      fromUrl,
      projectWorkspaceSlug: urlWorkspaceSlug,
      projectSlug: urlProjectSlug,
      projectId: urlProjectId,
    };
  }

  return {
    workspaceSlug,
    fromUrl,
    projectWorkspaceSlug: cached?.workspaceSlug ?? null,
    projectSlug: cached?.projectSlug ?? null,
    projectId: cached?.projectId ?? null,
  };
}

type ProjectLoaderData = {
  project: { id: string; workspaceSlug: string | null; workspaceName: string | null };
};

export type ActiveContext = ResolvedActiveContext & {
  /**
   * Workspace name from the project route loader — only non-null when the URL is
   * a `/w/:workspaceSlug/p/:projectSlug` route. Used by the switcher's
   * project-only-access pill without duplicating the route match.
   */
  urlProjectWorkspaceName: string | null;
};

/**
 * Resolve the active context (URL-first, cache-fallback) as one coherent unit,
 * and persist it to storage whenever the URL carries a FULL `(workspace,
 * project)` pair — so the cache only ever holds a coherent pair.
 */
export function useActiveContext(): ActiveContext {
  const router = useRouterState();
  const currentPath = router.location.pathname;

  const projectMatch = useMatch({ from: '/_app/w/$workspaceSlug/p/$projectSlug', shouldThrow: false });
  const projectLoader = projectMatch?.loaderData as ProjectLoaderData | undefined;
  const loaderWorkspaceSlug = projectLoader?.project.workspaceSlug ?? null;
  const urlProjectWorkspaceName = projectLoader?.project.workspaceName ?? null;
  const urlProjectId = projectLoader?.project.id ?? null;

  const urlWorkspaceSlug = parseWorkspaceSlug(currentPath) ?? loaderWorkspaceSlug;
  const urlProjectSlug = parseProjectSlug(currentPath);
  const hasUrlPair = urlWorkspaceSlug != null && urlProjectSlug != null;

  // Persist ONLY a full, coherent (workspace, project) pair — carrying the
  // server projectId when the loader knows it.
  useEffect(() => {
    if (urlWorkspaceSlug != null && urlProjectSlug != null) {
      writeActiveContext({
        workspaceSlug: urlWorkspaceSlug,
        projectSlug: urlProjectSlug,
        projectId: urlProjectId,
      });
    }
  }, [urlWorkspaceSlug, urlProjectSlug, urlProjectId]);

  // The cache is only needed to paint project-less routes; when the URL already
  // carries a full pair it is authoritative, so skip the read entirely.
  const cached = hasUrlPair ? null : readActiveContext();
  const cachedKey = cached ? JSON.stringify(cached) : null;

  // Reconcile the cached hint (an optimistic first-paint) against the server
  // authority once it resolves. We fetch once per distinct cached unit and hold
  // the "this unit is stale" decision in state so the drop survives re-renders.
  const [staleKey, setStaleKey] = useState<string | null>(null);
  const reconciledKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Only reconcile when actually painting from the cache (project-less route
    // with a remembered unit). A full URL pair is authoritative and freshly
    // re-written above, so it needs no reconciliation.
    if (cached == null || cachedKey == null) return;
    if (reconciledKeyRef.current === cachedKey) return;
    reconciledKeyRef.current = cachedKey;

    let cancelled = false;
    getLastActiveProject()
      .then((serverProject) => {
        if (cancelled) return;
        // Record the verdict for THIS unit either way: on disagreement (null =>
        // deleted / access revoked, or a different project) clear the stale hint
        // and drop it from the returned unit; on agreement reset any prior stale
        // flag so a re-cached, still-valid unit paints again.
        if (activeContextAgreesWithServer(cached, serverProject)) {
          setStaleKey(null);
        } else {
          clearActiveContext();
          setStaleKey(cachedKey);
        }
      })
      .catch(() => {
        // Network failure: keep the optimistic hint and allow a later retry.
        if (reconciledKeyRef.current === cachedKey) reconciledKeyRef.current = null;
      });

    return () => {
      cancelled = true;
      // Release the fetch guard so a re-setup re-issues the fetch. React
      // StrictMode mounts effects setup -> cleanup -> setup in dev; without this
      // the cleanup would cancel the only in-flight fetch and the guard would
      // block the re-setup, so reconciliation would never run. Also re-validates
      // on genuine remounts / when the same unit is revisited.
      if (reconciledKeyRef.current === cachedKey) reconciledKeyRef.current = null;
    };
    // Keyed on the primitive cachedKey so identity churn of `cached` (a fresh
    // object each render) never re-runs the effect.
  }, [cachedKey]);

  // Once the server has ruled this unit stale, paint as if the cache were empty
  // so the nav stops showing the stale /w/$ws/p/$proj link.
  const isStale = cachedKey != null && staleKey === cachedKey;
  const resolved = resolveActiveContext({
    urlWorkspaceSlug,
    urlProjectSlug,
    urlProjectId,
    cached: isStale ? null : cached,
  });

  return { ...resolved, urlProjectWorkspaceName };
}
