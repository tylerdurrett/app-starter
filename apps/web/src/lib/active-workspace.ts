import { useEffect } from 'react';
import { useRouterState, useMatch } from '@tanstack/react-router';

const WORKSPACE_STORAGE_KEY = 'lastActiveWorkspaceSlug';
const PROJECT_STORAGE_KEY = 'lastActiveProjectSlug';
const WORKSPACE_PATH_RE = /^\/w\/([^/]+)/;
const PROJECT_PATH_RE = /^\/p\/([^/]+)/;

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

type ProjectLoaderData = {
  project: { workspaceSlug: string | null; workspaceName: string | null };
};

export type ActiveWorkspaceContext = {
  slug: string | null;
  /** True when the slug is resolved from the current URL; false when falling back to localStorage. */
  fromUrl: boolean;
  /** Workspace name from the /p/:slug loader when present — used by callers that need the display name without duplicating the route match. */
  urlProjectWorkspaceName: string | null;
};

export function useActiveWorkspaceSlug(): ActiveWorkspaceContext {
  const router = useRouterState();
  const currentPath = router.location.pathname;

  const projectMatch = useMatch({ from: '/_app/w/$workspaceSlug/p/$projectSlug', shouldThrow: false });
  const projectLoader = projectMatch?.loaderData as ProjectLoaderData | undefined;
  const projectWorkspaceSlug = projectLoader?.project.workspaceSlug ?? null;
  const urlProjectWorkspaceName = projectLoader?.project.workspaceName ?? null;

  const urlSlug = currentPath.match(WORKSPACE_PATH_RE)?.[1] ?? projectWorkspaceSlug;

  useEffect(() => {
    if (urlSlug) safeWrite(WORKSPACE_STORAGE_KEY, urlSlug);
  }, [urlSlug]);

  if (urlSlug) return { slug: urlSlug, fromUrl: true, urlProjectWorkspaceName };
  return { slug: safeRead(WORKSPACE_STORAGE_KEY), fromUrl: false, urlProjectWorkspaceName: null };
}

export function useActiveProjectSlug(): { slug: string | null; fromUrl: boolean } {
  const router = useRouterState();
  const urlSlug = router.location.pathname.match(PROJECT_PATH_RE)?.[1] ?? null;

  useEffect(() => {
    if (urlSlug) safeWrite(PROJECT_STORAGE_KEY, urlSlug);
  }, [urlSlug]);

  if (urlSlug) return { slug: urlSlug, fromUrl: true };
  return { slug: safeRead(PROJECT_STORAGE_KEY), fromUrl: false };
}
