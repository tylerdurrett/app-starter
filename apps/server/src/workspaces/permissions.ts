export type WorkspaceRole = 'owner' | 'manager' | 'member';

export type WorkspacePermission =
  | 'workspace:read'
  | 'workspace:edit'
  | 'workspace:delete'
  | 'workspace:members:list'
  | 'workspace:members:invite'
  | 'workspace:members:remove'
  | 'workspace:invites:list'
  | 'workspace:invites:revoke'
  | 'projects:create'
  | 'integrations:read'
  | 'integrations:manage';

export const WORKSPACE_PERMISSIONS: Record<WorkspaceRole, Set<WorkspacePermission>> = {
  owner: new Set([
    'workspace:read',
    'workspace:edit',
    'workspace:delete',
    'workspace:members:list',
    'workspace:members:invite',
    'workspace:members:remove',
    'workspace:invites:list',
    'workspace:invites:revoke',
    'projects:create',
    'integrations:read',
    'integrations:manage',
  ]),
  manager: new Set([
    'workspace:read',
    'workspace:edit',
    'workspace:members:list',
    'workspace:members:invite',
    'workspace:members:remove',
    'workspace:invites:list',
    'workspace:invites:revoke',
    'projects:create',
    'integrations:read',
    'integrations:manage',
  ]),
  member: new Set([
    'workspace:read',
    'workspace:members:list',
    'workspace:invites:list',
    'projects:create',
    'integrations:read',
  ]),
};

/** Check whether a role has a given permission. */
export function can(role: WorkspaceRole, permission: WorkspacePermission): boolean {
  return WORKSPACE_PERMISSIONS[role].has(permission);
}
