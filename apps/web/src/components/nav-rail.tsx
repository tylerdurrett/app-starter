import { useRouterState, useMatch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Plug } from 'lucide-react';
import { TooltipProvider } from '@repo/ui';
import { NavTile } from './nav-tile';
import { WorkspaceSwitcher } from './workspace-switcher';
import { ProjectSwitcher } from './project-switcher';
import { useActiveContext } from '../lib/active-workspace';
import { workspaceQueryOptions, workspacesQueryOptions } from '../lib/workspace-queries';

export function NavRail() {
  const router = useRouterState();
  const currentPath = router.location.pathname;

  // Active workspace / project derivation (URL → localStorage fallback) lives
  // in one shared hook so the nav keeps its icons visible on workspace-less
  // routes like /account (where neither /w/:slug nor /p/:slug are in the URL).
  // The project slug is delivered as a coherent unit paired with the workspace
  // it belongs to (projectWorkspaceSlug) — never crossed with the URL workspace.
  const activeContext = useActiveContext();
  const {
    workspaceSlug: activeWorkspaceSlug,
    fromUrl,
    projectWorkspaceSlug,
    projectSlug: activeProjectSlug,
  } = activeContext;

  // The workspace route loader seeds this detail Query. Observe the Query value
  // rather than the loader snapshot so role/name changes update the shell.
  const workspaceMatch = useMatch({ from: '/_app/w/$workspaceSlug', shouldThrow: false });
  const routeWorkspaceSlug = workspaceMatch?.params.workspaceSlug ?? null;
  const workspaceQuery = useQuery({
    ...workspaceQueryOptions(routeWorkspaceSlug ?? ''),
    enabled: routeWorkspaceSlug != null,
  });

  // Workspace-less routes share this exact list Query with WorkspaceSwitcher.
  // Query retains prior data through refetches/errors and prevents stale
  // requests from overwriting newer cache state.
  const workspacesQuery = useQuery({
    ...workspacesQueryOptions(),
    enabled: routeWorkspaceSlug == null,
  });
  const fallbackWorkspaces = workspacesQuery.data ?? [];
  const fallbackWorkspace =
    fallbackWorkspaces.find((workspace) => workspace.slug === activeWorkspaceSlug) ??
    (!fromUrl ? fallbackWorkspaces[0] : undefined);
  const activeWorkspace = routeWorkspaceSlug != null ? workspaceQuery.data : fallbackWorkspace;

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

        <WorkspaceSwitcher activeContext={activeContext} activeWorkspace={activeWorkspace} />
      </nav>
    </TooltipProvider>
  );
}
