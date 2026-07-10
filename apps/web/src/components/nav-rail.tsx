import { useRouterState, useMatch } from '@tanstack/react-router';
import { LayoutDashboard, Plug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '@repo/ui';
import { NavTile } from './nav-tile';
import { WorkspaceSwitcher } from './workspace-switcher';
import { ProjectSwitcher } from './project-switcher';
import { listWorkspaces } from '../lib/workspaces';
import { useActiveContext } from '../lib/active-workspace';
import { type WorkspaceRole } from '../lib/permissions';

type ActiveWorkspace = { slug: string; role: WorkspaceRole };

export function NavRail() {
  const router = useRouterState();
  const currentPath = router.location.pathname;

  // Active workspace / project derivation (URL → localStorage fallback) lives
  // in one shared hook so the nav keeps its icons visible on workspace-less
  // routes like /account (where neither /w/:slug nor /p/:slug are in the URL).
  // The project slug is delivered as a coherent unit paired with the workspace
  // it belongs to (projectWorkspaceSlug) — never crossed with the URL workspace.
  const {
    workspaceSlug: activeWorkspaceSlug,
    fromUrl,
    projectWorkspaceSlug,
    projectSlug: activeProjectSlug,
  } = useActiveContext();

  // Primary source: the workspace route loader. On any /w/$slug/** URL this
  // gives us { slug, role } synchronously, so the shell never flickers waiting
  // on a second listWorkspaces() fetch.
  const workspaceMatch = useMatch({ from: '/_app/w/$workspaceSlug', shouldThrow: false });
  const loaderWorkspace = workspaceMatch?.loaderData?.workspace;
  const loaderActive: ActiveWorkspace | null = loaderWorkspace
    ? { slug: loaderWorkspace.slug, role: loaderWorkspace.role }
    : null;

  // Fallback for workspace-less routes (e.g. /account, /). We still need to
  // resolve a default workspace so brand-new users see something in the nav.
  // Retain the last known value on transient fetch errors so a blip doesn't
  // wipe the shell.
  const [fallbackWorkspace, setFallbackWorkspace] = useState<ActiveWorkspace | null>(null);
  const lastFallbackRef = useRef<ActiveWorkspace | null>(null);
  const needsFallback = !loaderActive;

  useEffect(() => {
    if (!needsFallback) return;
    let cancelled = false;
    listWorkspaces()
      .then((workspaces) => {
        if (cancelled) return;
        let ws = activeWorkspaceSlug
          ? workspaces.find((w) => w.slug === activeWorkspaceSlug)
          : undefined;
        if (!ws && !fromUrl) ws = workspaces[0];
        const next = ws ? { slug: ws.slug, role: ws.role } : null;
        lastFallbackRef.current = next;
        setFallbackWorkspace(next);
      })
      .catch(() => {
        // Keep last known value — a failed fetch shouldn't strip the nav.
        if (!cancelled) setFallbackWorkspace(lastFallbackRef.current);
      });
    return () => {
      cancelled = true;
    };
  }, [needsFallback, activeWorkspaceSlug, fromUrl]);

  const activeWorkspace = loaderActive ?? fallbackWorkspace;

  // Only highlight a project in the switcher when it actually belongs to the
  // workspace currently on display — otherwise a project remembered from
  // another workspace would light up the wrong row.
  const switcherProjectSlug =
    activeWorkspace && projectWorkspaceSlug === activeWorkspace.slug ? activeProjectSlug : null;

  // The Dashboard link is built from the coherent unit's OWN workspace+project,
  // never activeWorkspace.slug × a cached project — that pairing would resolve
  // to the wrong project (post-ADR-0009 slugs are unique only per-workspace).
  const showDashboard = Boolean(activeWorkspace && projectWorkspaceSlug && activeProjectSlug);

  return (
    <TooltipProvider delay={150}>
      <nav className="w-20 bg-card border-r flex flex-col">
        {activeWorkspace && (
          <>
            <ProjectSwitcher
              workspaceSlug={activeWorkspace.slug}
              workspaceRole={activeWorkspace.role}
              activeProjectSlug={switcherProjectSlug}
            />
            <div className="border-b" />
          </>
        )}

        {showDashboard && projectWorkspaceSlug && activeProjectSlug && (
          <>
            {/* Dashboard uses exact-match — it's the /p/:slug index route, so nested pages shouldn't light it up. */}
            <NavTile
              label="Dashboard"
              icon={LayoutDashboard}
              to="/w/$workspaceSlug/p/$projectSlug"
              params={{ workspaceSlug: projectWorkspaceSlug, projectSlug: activeProjectSlug }}
              active={currentPath === `/w/${projectWorkspaceSlug}/p/${activeProjectSlug}`}
            />
          </>
        )}

        {/* Grouped so Integrations sits flush to the divider — two mt-auto siblings would split the free space. */}
        <div className="mt-auto">
          {activeWorkspace && (
            <NavTile
              label="Integrations"
              icon={Plug}
              to="/w/$workspaceSlug/integrations"
              params={{ workspaceSlug: activeWorkspace.slug }}
              active={currentPath.startsWith(`/w/${activeWorkspace.slug}/integrations`)}
            />
          )}
          <div className="border-b" />
        </div>

        <WorkspaceSwitcher />
      </nav>
    </TooltipProvider>
  );
}
