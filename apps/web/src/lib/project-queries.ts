// TanStack Query option factories for the project settings page (ADR-0007).
//
// Each factory pairs a shared query key (query-keys.ts — the single source of
// truth) with the matching projects lib fetcher, so the settings component and
// any writer that invalidates agree on the exact tuple. Extracting the wiring
// here keeps it unit-testable without renderHook/jsdom infra: the component
// just spreads the returned { queryKey, queryFn } into useQuery.
import { queryKeys } from './query-keys';
import {
  getProject,
  listProjectMembers,
  listProjectInvites,
  type ProjectWithWorkspace,
  type ProjectMember,
  type ProjectInvite,
} from './projects';

// Detail read: the layout loader seeds this key, so the settings component's
// useQuery hits the cache on first paint and a rename's invalidation refreshes
// the displayed name live (ADR-0007).
export function projectQueryOptions(workspaceSlug: string, slug: string) {
  return {
    queryKey: queryKeys.project(workspaceSlug, slug),
    queryFn: (): Promise<ProjectWithWorkspace> => getProject(workspaceSlug, slug),
  };
}

export function projectMembersQueryOptions(workspaceSlug: string, slug: string) {
  return {
    queryKey: queryKeys.projectMembers(workspaceSlug, slug),
    queryFn: (): Promise<ProjectMember[]> => listProjectMembers(workspaceSlug, slug),
  };
}

export function projectInvitesQueryOptions(workspaceSlug: string, slug: string) {
  return {
    queryKey: queryKeys.projectInvites(workspaceSlug, slug),
    queryFn: (): Promise<ProjectInvite[]> => listProjectInvites(workspaceSlug, slug),
  };
}
