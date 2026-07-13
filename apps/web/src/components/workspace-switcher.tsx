import { useState, useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button, Input } from '@repo/ui';
import { Plus, Settings, User, LogOut, Check } from 'lucide-react';
import { createWorkspace, type WorkspaceWithRole } from '../lib/workspaces';
import { canWorkspace } from '../lib/permissions';
import { signOut } from '../lib/auth-client';
import { type ActiveContext } from '../lib/active-workspace';
import { completeSignOutTransition } from '../lib/auth-transitions';
import { workspacesQueryOptions } from '../lib/workspace-queries';
import {
  Selector,
  SelectorDivider,
  SelectorRowContent,
  SelectorSectionLabel,
  selectorRowClass,
} from './selector';

interface WorkspaceSwitcherProps {
  activeContext: ActiveContext;
  activeWorkspace?: WorkspaceWithRole;
}

export function WorkspaceSwitcher({ activeContext, activeWorkspace }: WorkspaceSwitcherProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Shared derivation: URL first, then localStorage fallback so the switcher
  // keeps its active workspace on workspace-less routes like /account.
  // `urlProjectWorkspaceName` feeds the project-only-access pill and is only
  // non-null when we're actually on /p/:slug (not when falling back to storage).
  const {
    workspaceSlug: activeSlug,
    fromUrl,
    urlProjectWorkspaceName: contextualName,
  } = activeContext;
  const workspaceListQueryOptions = workspacesQueryOptions();
  const workspacesQuery = useQuery(workspaceListQueryOptions);
  const workspaces = workspacesQuery.data ?? [];

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const createInFlight = useRef(false);
  const createMutation = useMutation({
    mutationFn: (workspaceName: string) => createWorkspace(workspaceName),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({
        queryKey: workspaceListQueryOptions.queryKey,
        exact: true,
      });
      await navigate({
        to: '/w/$workspaceSlug',
        params: { workspaceSlug: workspace.slug },
      });
    },
    onSettled: () => {
      createInFlight.current = false;
    },
  });

  // When there's no URL context (e.g. /account) and no remembered slug, fall
  // back to the first available workspace so the switcher trigger always shows
  // something meaningful instead of the generic "Workspace" placeholder.
  const matchedWorkspace = workspaces.find((ws) => ws.slug === activeSlug);
  const selectedWorkspace =
    activeWorkspace ?? matchedWorkspace ?? (!fromUrl ? workspaces[0] : undefined);
  const hasDirectAccess = Boolean(selectedWorkspace);
  const displayName = selectedWorkspace?.name ?? contextualName;

  const canAccessWorkspaceSettings =
    hasDirectAccess && selectedWorkspace && canWorkspace(selectedWorkspace.role, 'workspace:read');

  const resetCreateForm = useCallback(() => {
    setShowCreateForm(false);
    setNewName('');
    createMutation.reset();
  }, [createMutation]);

  const handleLogout = async () => {
    await completeSignOutTransition(queryClient, signOut, () => {
      window.location.href = '/login';
    });
  };

  return (
    <Selector
      ariaLabel="Switch workspace"
      openDirection="up"
      trigger={{
        title: displayName ?? 'Workspace',
        avatarLabel: displayName ? displayName[0]!.toUpperCase() : 'W',
      }}
      onOpen={() => {
        void workspacesQuery.refetch({ cancelRefetch: false });
      }}
      onClose={resetCreateForm}
    >
      {({ close }) => {
        const handleCreate = (e: React.FormEvent) => {
          e.preventDefault();
          const trimmed = newName.trim();
          if (!trimmed || createInFlight.current) return;

          createInFlight.current = true;
          createMutation.reset();
          createMutation.mutate(trimmed, { onSuccess: close });
        };

        return (
          <>
            <SelectorSectionLabel>Workspaces</SelectorSectionLabel>

            {workspacesQuery.isPending && (
              <div className="px-2 py-3 text-sm text-muted-foreground text-center">Loading...</div>
            )}

            {workspacesQuery.isError && workspacesQuery.data === undefined && (
              <div className="px-2 py-3 text-sm text-destructive text-center">
                Failed to load workspaces
              </div>
            )}

            {workspacesQuery.data !== undefined && (
              <ul className="space-y-0.5">
                {workspaces.map((ws) => {
                  const isActive = ws.slug === selectedWorkspace?.slug;
                  return (
                    <li key={ws.id}>
                      <Link
                        to="/w/$workspaceSlug"
                        params={{ workspaceSlug: ws.slug }}
                        onClick={close}
                        className={selectorRowClass(isActive)}
                      >
                        <SelectorRowContent name={ws.name} isActive={isActive} />
                      </Link>
                    </li>
                  );
                })}
                {!hasDirectAccess && contextualName && (
                  <li
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-sm bg-accent/30 text-muted-foreground cursor-default"
                    title="You can access a project in this workspace but not the workspace itself"
                  >
                    <div className="w-6 h-6 rounded bg-muted flex items-center justify-center text-xs font-semibold shrink-0">
                      {contextualName[0]?.toUpperCase()}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate">{contextualName}</span>
                      <span className="text-[10px] uppercase tracking-wide">
                        project-only access
                      </span>
                    </div>
                    <Check className="w-4 h-4 ml-auto shrink-0" />
                  </li>
                )}
                {workspaces.length === 0 && !contextualName && (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">No workspaces yet</li>
                )}
              </ul>
            )}

            <SelectorDivider />

            {!showCreateForm ? (
              <button
                type="button"
                onClick={() => setShowCreateForm(true)}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-sm w-full text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                New workspace
              </button>
            ) : (
              <form onSubmit={handleCreate} className="px-2 py-1.5 space-y-2">
                <Input
                  placeholder="Workspace name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={createMutation.isPending}
                  required
                  autoFocus
                  className="h-8 text-sm"
                />
                {createMutation.isError && (
                  <div className="text-xs text-destructive" role="alert">
                    Failed to create workspace
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={createMutation.isPending || !newName.trim()}
                    className="flex-1"
                  >
                    {createMutation.isPending ? 'Creating...' : 'Create'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={resetCreateForm}
                    disabled={createMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}

            {selectedWorkspace && canAccessWorkspaceSettings && (
              <>
                <SelectorDivider />
                <Link
                  to="/w/$workspaceSlug/settings"
                  params={{ workspaceSlug: selectedWorkspace.slug }}
                  onClick={close}
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-sm w-full text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Workspace settings
                </Link>
              </>
            )}

            <SelectorDivider />
            <Link
              to="/account"
              onClick={close}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm w-full text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
            >
              <User className="w-4 h-4" />
              Account
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm w-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
          </>
        );
      }}
    </Selector>
  );
}
