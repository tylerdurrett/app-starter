import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { WorkspaceMember, WorkspaceWithRole } from '@repo/shared';
import { useSession } from '../../lib/auth-client';
import { canWorkspace, type WorkspaceRole } from '../../lib/permissions';
import { resolveProject } from '../../lib/project-resolver';
import { queryKeys } from '../../lib/query-keys';
import {
  createWorkspaceInvite,
  deleteWorkspace,
  getWorkspace,
  listWorkspaceInvites,
  listWorkspaceMembers,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  updateWorkspace,
} from '../../lib/workspaces';
import { ConfirmedDeleteSettings } from './confirmed-delete-settings';
import { InviteSettings } from './invite-settings';
import { MembershipSettings } from './membership-settings';
import { NameSettings } from './name-settings';

interface WorkspaceDestination {
  to: string;
  params?: Record<string, string>;
}

interface WorkspaceSettingsDependencies {
  getWorkspace: typeof getWorkspace;
  updateWorkspace: typeof updateWorkspace;
  listMembers: typeof listWorkspaceMembers;
  removeMember: typeof removeWorkspaceMember;
  listInvites: typeof listWorkspaceInvites;
  createInvite: typeof createWorkspaceInvite;
  revokeInvite: typeof revokeWorkspaceInvite;
  deleteWorkspace: typeof deleteWorkspace;
  resolveDestination: typeof resolveProject;
}

const defaultDependencies: WorkspaceSettingsDependencies = {
  getWorkspace,
  updateWorkspace,
  listMembers: listWorkspaceMembers,
  removeMember: removeWorkspaceMember,
  listInvites: listWorkspaceInvites,
  createInvite: createWorkspaceInvite,
  revokeInvite: revokeWorkspaceInvite,
  deleteWorkspace,
  resolveDestination: resolveProject,
};

interface CreateWorkspaceSettingsAdaptersOptions {
  workspaceSlug: string;
  role: WorkspaceRole;
  queryClient: QueryClient;
  navigate: (destination: WorkspaceDestination) => Promise<unknown> | unknown;
  dependencies?: WorkspaceSettingsDependencies;
}

export function createWorkspaceSettingsAdapters({
  workspaceSlug,
  role,
  queryClient,
  navigate,
  dependencies = defaultDependencies,
}: CreateWorkspaceSettingsAdaptersOptions) {
  const refreshNameObservers = (client: QueryClient) =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.workspace(workspaceSlug) }),
      client.invalidateQueries({ queryKey: queryKeys.workspaces() }),
    ]);

  return {
    name: {
      queryOptions: {
        queryKey: queryKeys.workspace(workspaceSlug),
        queryFn: () => dependencies.getWorkspace(workspaceSlug),
      },
      canEdit: canWorkspace(role, 'workspace:edit'),
      inputPlaceholder: 'Workspace name',
      errorFallback: 'Failed to update workspace name',
      updateName: (name: string) => dependencies.updateWorkspace(workspaceSlug, name),
      refresh: refreshNameObservers,
    },
    membership: {
      queryKey: queryKeys.workspaceMembers(workspaceSlug),
      listMembers: () => dependencies.listMembers(workspaceSlug),
      removeMember: (userId: string) => dependencies.removeMember(workspaceSlug, userId),
      canList: canWorkspace(role, 'workspace:members:list'),
      canRemove: (member: WorkspaceMember) =>
        canWorkspace(role, 'workspace:members:remove') &&
        (role === 'owner' || member.role !== 'owner'),
    },
    invites: {
      queryKey: queryKeys.workspaceInvites(workspaceSlug),
      listInvites: () => dependencies.listInvites(workspaceSlug),
      createInvite: (email: string, inviteRole: 'manager' | 'member') =>
        dependencies.createInvite(workspaceSlug, email, inviteRole),
      revokeInvite: (inviteId: string) => dependencies.revokeInvite(workspaceSlug, inviteId),
      refreshInvites: () =>
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaceInvites(workspaceSlug) }),
      canList: canWorkspace(role, 'workspace:invites:list'),
      canCreate: canWorkspace(role, 'workspace:members:invite'),
      canRevoke: canWorkspace(role, 'workspace:invites:revoke'),
    },
    deletion: canWorkspace(role, 'workspace:delete')
      ? {
          queryOptions: {
            queryKey: queryKeys.workspace(workspaceSlug),
            queryFn: () => dependencies.getWorkspace(workspaceSlug),
          },
          getName: (workspace: WorkspaceWithRole) => workspace.name,
          title: 'Delete this workspace',
          consequence:
            'This action cannot be undone. All projects and data will be permanently deleted.',
          revealButton: 'Delete workspace',
          confirmButton: 'Delete workspace',
          pendingButton: 'Deleting workspace...',
          deletedButton: 'Workspace deleted',
          errorFallback: 'Failed to delete workspace',
          deleteResource: (confirmation: string) =>
            dependencies.deleteWorkspace(workspaceSlug, confirmation),
          refreshAfterDelete: (client: QueryClient) =>
            client.invalidateQueries({ queryKey: queryKeys.workspaces() }),
          onDeleted: async () => {
            await navigate(await dependencies.resolveDestination());
          },
        }
      : undefined,
  };
}

export function WorkspaceSettings({
  workspaceSlug,
  role,
}: {
  workspaceSlug: string;
  role: WorkspaceRole;
}) {
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const adapters = createWorkspaceSettingsAdapters({
    workspaceSlug,
    role,
    queryClient,
    navigate: (destination) => navigate(destination),
  });

  return (
    <>
      <NameSettings adapter={adapters.name} />
      <MembershipSettings
        adapter={adapters.membership}
        currentUserId={session.data?.user?.id}
      />
      <InviteSettings adapter={adapters.invites} />
      {adapters.deletion && <ConfirmedDeleteSettings adapter={adapters.deletion} />}
    </>
  );
}
