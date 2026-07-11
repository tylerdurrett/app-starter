// TanStack Query option factories for the workspace settings page (ADR-0007).
//
// Extracted out of the route component so the query-key wiring and the
// per-write cache invalidation are unit-testable in the node vitest env
// (no jsdom / renderHook needed): the component consumes these factories,
// while the tests assert each one produces the expected `queryKeys.*` tuple
// and invalidates the correct key on success.
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './query-keys';
import {
  getWorkspace,
  listWorkspaceMembers,
  removeWorkspaceMember,
  listWorkspaceInvites,
  createWorkspaceInvite,
  revokeWorkspaceInvite,
  updateWorkspace,
  deleteWorkspace,
} from './workspaces';

// --- Reads ---

// Detail read: the layout loader seeds this key, so the settings component's
// useQuery hits the cache on first paint and a rename's invalidation refreshes
// the displayed name live (ADR-0007).
export function workspaceQueryOptions(slug: string) {
  return {
    queryKey: queryKeys.workspace(slug),
    queryFn: () => getWorkspace(slug),
  };
}

export function workspaceMembersQuery(slug: string) {
  return {
    queryKey: queryKeys.workspaceMembers(slug),
    queryFn: () => listWorkspaceMembers(slug),
  };
}

export function workspaceInvitesQuery(slug: string) {
  return {
    queryKey: queryKeys.workspaceInvites(slug),
    queryFn: () => listWorkspaceInvites(slug),
  };
}

// --- Writes ---
// Each mutation factory takes the QueryClient and invalidates precisely the
// key its write affects, so the UI reflects the change without a manual reload.

export function renameWorkspaceMutation(queryClient: QueryClient, slug: string) {
  return {
    mutationFn: (name: string) => updateWorkspace(slug, name),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.workspace(slug) }),
  };
}

export function removeWorkspaceMemberMutation(queryClient: QueryClient, slug: string) {
  return {
    mutationFn: (userId: string) => removeWorkspaceMember(slug, userId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceMembers(slug) }),
  };
}

export function createWorkspaceInviteMutation(queryClient: QueryClient, slug: string) {
  return {
    mutationFn: ({ email, role }: { email: string; role: 'manager' | 'member' }) =>
      createWorkspaceInvite(slug, email, role),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceInvites(slug) }),
  };
}

export function revokeWorkspaceInviteMutation(queryClient: QueryClient, slug: string) {
  return {
    mutationFn: (inviteId: string) => revokeWorkspaceInvite(slug, inviteId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaceInvites(slug) }),
  };
}

export function deleteWorkspaceMutation(queryClient: QueryClient, slug: string) {
  return {
    mutationFn: (confirmation: string) => deleteWorkspace(slug, confirmation),
    // Delete removes the workspace from any cached list; the component adds
    // its own navigation via the mutate() onSuccess callback.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() }),
  };
}
