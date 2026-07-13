import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import {
  lastActiveProjectValidationQueryOptions,
  projectQueryOptions,
} from './project-queries';
import type { Project } from './projects';

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

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // storage disabled (private mode, quota, etc.) — nothing to clear
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
  safeRemove(ACTIVE_CONTEXT_KEY);
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

  const urlWorkspaceSlug = parseWorkspaceSlug(currentPath);
  const urlProjectSlug = parseProjectSlug(currentPath);
  const hasUrlPair = urlWorkspaceSlug != null && urlProjectSlug != null;
  const projectQuery = useQuery({
    ...projectQueryOptions(urlWorkspaceSlug ?? '', urlProjectSlug ?? ''),
    enabled: hasUrlPair,
  });
  const urlProject = hasUrlPair ? projectQuery.data : undefined;
  const urlProjectWorkspaceName = urlProject?.workspaceName ?? null;
  const urlProjectId = urlProject?.id ?? null;

  // Persist ONLY a full, coherent (workspace, project) pair — carrying the
  // server projectId when the loader knows it.
  useEffect(() => {
    if (urlWorkspaceSlug != null && urlProjectSlug != null && urlProject != null) {
      writeActiveContext({
        workspaceSlug: urlProject.workspaceSlug,
        projectSlug: urlProject.slug,
        projectId: urlProject.id,
      });
    }
  }, [urlWorkspaceSlug, urlProjectSlug, urlProject]);

  // The cache is only needed to paint project-less routes; when the URL already
  // carries a full pair it is authoritative, so skip the read entirely.
  const cached = hasUrlPair ? null : readActiveContext();
  const validationQuery = useQuery({
    ...lastActiveProjectValidationQueryOptions(
      cached ?? { workspaceSlug: '', projectSlug: '', projectId: null },
    ),
    enabled: cached != null,
  });

  // A cached verdict is authoritative only after the request for this exact
  // hint has settled successfully. While a first read or refetch is pending,
  // or when a refetch failed with prior data retained, preserve the optimistic
  // hint. The full hint-scoped query key prevents an A verdict from judging B.
  const hasSettledVerdict =
    cached != null && validationQuery.status === 'success' && validationQuery.fetchStatus === 'idle';
  const isStale =
    cached != null &&
    hasSettledVerdict &&
    !activeContextAgreesWithServer(cached, validationQuery.data);

  useEffect(() => {
    if (isStale) clearActiveContext();
  }, [isStale]);

  const resolved = resolveActiveContext({
    urlWorkspaceSlug,
    urlProjectSlug,
    urlProjectId,
    cached: isStale ? null : cached,
  });

  return { ...resolved, urlProjectWorkspaceName };
}
