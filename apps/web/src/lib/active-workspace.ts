import { useEffect } from 'react';
import { useRouterState, useMatch } from '@tanstack/react-router';

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
  const resolved = resolveActiveContext({ urlWorkspaceSlug, urlProjectSlug, urlProjectId, cached });

  return { ...resolved, urlProjectWorkspaceName };
}

// --- Transitional thin wrappers ---------------------------------------------
// Kept so this module typechecks on its own before the consumers are repointed
// at useActiveContext in the next commit. Removed there.

export type ActiveWorkspaceContext = {
  slug: string | null;
  fromUrl: boolean;
  urlProjectWorkspaceName: string | null;
};

export function useActiveWorkspaceSlug(): ActiveWorkspaceContext {
  const { workspaceSlug, fromUrl, urlProjectWorkspaceName } = useActiveContext();
  return { slug: workspaceSlug, fromUrl, urlProjectWorkspaceName };
}

export function useActiveProjectSlug(): { slug: string | null; fromUrl: boolean } {
  const { projectSlug } = useActiveContext();
  return { slug: projectSlug, fromUrl: false };
}
