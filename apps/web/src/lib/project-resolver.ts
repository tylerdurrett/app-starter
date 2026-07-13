import type { QueryClient } from '@tanstack/react-query';
import {
  accessibleProjectsQueryOptions,
  lastActiveProjectQueryOptions,
} from './project-queries';
import { workspacesQueryOptions } from './workspace-queries';

interface ProjectRedirectTarget {
  to: string;
  params?: Record<string, string>;
}

/**
 * Resolves the best project destination for the current user.
 *
 * Resolution order:
 * 1. Last-active project (from user preference)
 * 2. First project in the user's list (ordered by createdAt asc)
 * 3. First workspace if no projects exist (for Phase 4 compatibility)
 * 4. Onboarding page if the user has no workspaces or projects
 *
 * Returns a navigation target compatible with both TanStack Router's
 * `redirect()` (in beforeLoad) and `navigate()` (in event handlers).
 */
export async function resolveProject(queryClient: QueryClient): Promise<ProjectRedirectTarget> {
  const lastActive = await queryClient.fetchQuery(lastActiveProjectQueryOptions());
  if (lastActive) {
    return {
      to: '/w/$workspaceSlug/p/$projectSlug',
      params: { workspaceSlug: lastActive.workspaceSlug, projectSlug: lastActive.slug },
    };
  }

  const projects = await queryClient.fetchQuery(accessibleProjectsQueryOptions());
  const firstProject = projects[0];
  if (firstProject) {
    return {
      to: '/w/$workspaceSlug/p/$projectSlug',
      params: { workspaceSlug: firstProject.workspaceSlug, projectSlug: firstProject.slug },
    };
  }

  // Fall back to workspace if no projects exist (Phase 4 compatibility)
  const workspaces = await queryClient.fetchQuery(workspacesQueryOptions());
  const firstWorkspace = workspaces[0];
  if (firstWorkspace) {
    return { to: '/w/$workspaceSlug', params: { workspaceSlug: firstWorkspace.slug } };
  }

  return { to: '/onboarding/create-workspace' };
}
