import { useRouterState, useMatch } from '@tanstack/react-router';
import { LayoutDashboard, Plug } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { TooltipProvider } from '@repo/ui';
import { NavTile } from './nav-tile';
import { WorkspaceSwitcher } from './workspace-switcher';
import { ProjectSwitcher } from './project-switcher';
import { listWorkspaces } from '../lib/workspaces';
import { useActiveWorkspaceSlug, useActiveProjectSlug } from '../lib/active-workspace';
import { type WorkspaceRole } from '../lib/permissions';

type ActiveWorkspace = { slug: string; role: WorkspaceRole };

export function NavRail() {
  const router = useRouterState();
  const currentPath = router.location.pathname;

  // Active workspace / project derivation (URL → localStorage fallback) lives
  // in shared hooks so the nav keeps its icons visible on workspace-less
  // routes like /account (where neither /w/:slug nor /p/:slug are in the URL).
  const { slug: activeWorkspaceSlug, fromUrl } = useActiveWorkspaceSlug();
  const { slug: activeProjectSlug } = useActiveProjectSlug();

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

  return (
    <TooltipProvider delay={150}>
      <nav className="w-20 bg-card border-r flex flex-col">
        {activeWorkspace && (
          <>
            <ProjectSwitcher
              workspaceSlug={activeWorkspace.slug}
              workspaceRole={activeWorkspace.role}
              activeProjectSlug={activeProjectSlug}
            />
            <div className="border-b" />
          </>
        )}

        {activeProjectSlug && (
          <>
            {/* Dashboard uses exact-match — it's the /p/:slug index route, so nested pages shouldn't light it up. */}
            <NavTile
              label="Dashboard"
              icon={LayoutDashboard}
              to="/p/$projectSlug"
              params={{ projectSlug: activeProjectSlug }}
              active={currentPath === `/p/${activeProjectSlug}`}
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
