import type { QueryClient } from '@tanstack/react-query';
import type { NavigateOptions } from '@tanstack/react-router';
import type { ConfirmedDeleteSettingsAdapter } from '../components/settings/confirmed-delete-settings';
import type { InviteSettingsAdapter } from '../components/settings/invite-settings';
import type { MembershipSettingsAdapter } from '../components/settings/membership-settings';
import type { NameSettingsAdapter } from '../components/settings/name-settings';
import { canProject, type ProjectRole } from './permissions';
import {
  createProjectInvite,
  deleteProject,
  removeProjectMember,
  revokeProjectInvite,
  updateProject,
  type ProjectMember,
  type ProjectWithWorkspace,
} from './projects';
import {
  projectInvitesQueryOptions,
  projectMembersQueryOptions,
  projectQueryOptions,
} from './project-queries';
import { queryKeys } from './query-keys';

interface ProjectSettingsAdapterOptions {
  workspaceSlug: string;
  projectSlug: string;
  role: ProjectRole;
  currentUserId?: string;
  queryClient: QueryClient;
  navigate: (options: NavigateOptions) => Promise<void>;
}

export interface ProjectSettingsAdapters {
  name: NameSettingsAdapter<ProjectWithWorkspace>;
  membership: MembershipSettingsAdapter<ProjectMember>;
  invites: InviteSettingsAdapter;
  deletion: ConfirmedDeleteSettingsAdapter<ProjectWithWorkspace>;
  currentUserId?: string;
  canDelete: boolean;
}

/**
 * Bind the shared settings workflows to Project-specific behavior.
 *
 * `role` is the effective role returned by the parent Project loader. It may
 * come from a direct Project Membership or the Workspace override; Project
 * permissions deliberately apply the same way to either source.
 */
export function createProjectSettingsAdapters({
  workspaceSlug,
  projectSlug,
  role,
  currentUserId,
  queryClient,
  navigate,
}: ProjectSettingsAdapterOptions): ProjectSettingsAdapters {
  const projectQuery = projectQueryOptions(workspaceSlug, projectSlug);
  const membersQuery = projectMembersQueryOptions(workspaceSlug, projectSlug);
  const invitesQuery = projectInvitesQueryOptions(workspaceSlug, projectSlug);

  return {
    name: {
      queryOptions: projectQuery,
      canEdit: canProject(role, 'project:edit'),
      inputPlaceholder: 'Project name',
      errorFallback: 'Failed to update project name',
      updateName: (name) => updateProject(workspaceSlug, projectSlug, { name }),
      refresh: async (client) => {
        await Promise.all([
          client.invalidateQueries({ queryKey: queryKeys.project(workspaceSlug, projectSlug) }),
          client.invalidateQueries({ queryKey: queryKeys.projects(workspaceSlug) }),
        ]);
      },
    },
    membership: {
      queryKey: membersQuery.queryKey,
      listMembers: membersQuery.queryFn,
      removeMember: (userId) => removeProjectMember(workspaceSlug, projectSlug, userId),
      canList: canProject(role, 'project:members:list'),
      // Project membership has no Workspace-style owner-target veto. The
      // shared workflow independently suppresses the signed-in user's row.
      canRemove: () => canProject(role, 'project:members:remove'),
    },
    invites: {
      queryKey: invitesQuery.queryKey,
      listInvites: invitesQuery.queryFn,
      createInvite: (email, inviteRole) =>
        createProjectInvite(workspaceSlug, projectSlug, email, inviteRole),
      revokeInvite: (inviteId) => revokeProjectInvite(workspaceSlug, projectSlug, inviteId),
      refreshInvites: () =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.projectInvites(workspaceSlug, projectSlug),
        }),
      canList: canProject(role, 'project:invites:list'),
      canCreate: canProject(role, 'project:members:invite'),
      canRevoke: canProject(role, 'project:invites:revoke'),
    },
    deletion: {
      queryOptions: projectQuery,
      getName: (project) => project.name,
      title: 'Delete this project',
      consequence: 'This action cannot be undone. All project data will be permanently deleted.',
      revealButton: 'Delete project',
      confirmButton: 'Permanently delete',
      pendingButton: 'Deleting project...',
      deletedButton: 'Project deleted',
      errorFallback: 'Failed to delete project',
      deleteResource: (confirmation) => deleteProject(workspaceSlug, projectSlug, confirmation),
      refreshAfterDelete: (client) =>
        client.invalidateQueries({ queryKey: queryKeys.projects(workspaceSlug) }),
      onDeleted: () =>
        navigate({
          to: '/w/$workspaceSlug',
          params: { workspaceSlug },
        }),
    },
    currentUserId,
    canDelete: canProject(role, 'project:delete'),
  };
}
