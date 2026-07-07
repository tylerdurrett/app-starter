import { getLastActiveProject, listProjects } from './projects';
import { listWorkspaces } from './workspaces';

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
export async function resolveProject(): Promise<ProjectRedirectTarget> {
  const lastActive = await getLastActiveProject();
  if (lastActive) {
    return { to: '/p/$projectSlug', params: { projectSlug: lastActive.slug } };
  }

  const projects = await listProjects();
  const firstProject = projects[0];
  if (firstProject) {
    return { to: '/p/$projectSlug', params: { projectSlug: firstProject.slug } };
  }

  // Fall back to workspace if no projects exist (Phase 4 compatibility)
  const workspaces = await listWorkspaces();
  const firstWorkspace = workspaces[0];
  if (firstWorkspace) {
    return { to: '/w/$workspaceSlug', params: { workspaceSlug: firstWorkspace.slug } };
  }

  return { to: '/onboarding/create-workspace' };
}

// Keep resolveWorkspace for backward compatibility (will be removed later)
export async function resolveWorkspace(): Promise<ProjectRedirectTarget> {
  return resolveProject();
}