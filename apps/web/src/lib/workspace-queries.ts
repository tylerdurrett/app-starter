import { queryKeys } from './query-keys';
import {
  getWorkspace,
  listProjectsForWorkspace,
  listWorkspaces,
} from './workspaces';

export function workspacesQueryOptions() {
  return {
    queryKey: queryKeys.workspaces(),
    queryFn: listWorkspaces,
  };
}

export function workspaceQueryOptions(slug: string) {
  return {
    queryKey: queryKeys.workspace(slug),
    queryFn: () => getWorkspace(slug),
  };
}

export function workspaceProjectsQueryOptions(slug: string) {
  return {
    queryKey: queryKeys.projects(slug),
    queryFn: () => listProjectsForWorkspace(slug),
  };
}
