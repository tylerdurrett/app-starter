import type { FastifyRequest } from 'fastify';
import { getSessionFromRequest } from './get-session.js';
import { resolveWorkspaceAndRole } from '../workspaces/service.js';
import { resolveProjectWithOverride } from '../projects/resolver.js';
import type { WorkspacePermission } from '../workspaces/permissions.js';
import type { ProjectPermission } from '../projects/permissions.js';

/** HTTP-layer error with a status code. Thrown by guards, caught by the error handler. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export async function requireUser(req: FastifyRequest) {
  const result = await getSessionFromRequest(req);
  if (!result) throw new HttpError(401, 'Unauthorized');
  return result;
}

/**
 * Require an authenticated session with a specific workspace permission.
 *
 * HTTP semantics (via global error handler):
 * - 401 when unauthenticated
 * - 404 when workspace does not exist or user is not a member
 * - 403 when user is a member but lacks the permission
 */
export async function requireWorkspacePermission(
  req: FastifyRequest,
  slug: string,
  permission: WorkspacePermission,
) {
  const { user } = await requireUser(req);
  // ServiceError from resolveWorkspaceAndRole bubbles to the global error handler
  const { workspace, role } = await resolveWorkspaceAndRole(slug, user.id, permission);
  return { user, workspace, role };
}

/**
 * Require an authenticated session with a specific project permission.
 * Uses workspace admin override - workspace owner/manager can access projects.
 *
 * HTTP semantics (via global error handler):
 * - 401 when unauthenticated
 * - 404 when project does not exist or user has no access
 * - 403 when user has access but lacks the permission
 */
export async function requireProjectPermission(
  req: FastifyRequest,
  projectSlug: string,
  permission: ProjectPermission,
  workspaceSlug: string,
) {
  const { user } = await requireUser(req);
  // ServiceError from resolveProjectWithOverride bubbles to the global error handler
  const { project, role, viaWorkspaceOverride } = await resolveProjectWithOverride(
    projectSlug,
    user.id,
    permission,
    workspaceSlug
  );
  return { user, project, role, viaWorkspaceOverride };
}
