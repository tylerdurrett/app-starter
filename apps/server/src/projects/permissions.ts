export type ProjectRole = 'owner' | 'manager' | 'member';

export type ProjectPermission =
  | 'project:read'
  | 'project:edit'
  | 'project:delete'
  | 'project:members:list'
  | 'project:members:invite'
  | 'project:members:remove'
  | 'project:invites:list'
  | 'project:invites:revoke';

export const PROJECT_PERMISSIONS: Record<ProjectRole, Set<ProjectPermission>> = {
  owner: new Set([
    'project:read',
    'project:edit',
    'project:delete',
    'project:members:list',
    'project:members:invite',
    'project:members:remove',
    'project:invites:list',
    'project:invites:revoke',
  ]),
  manager: new Set([
    'project:read',
    'project:edit',
    'project:members:list',
    'project:members:invite',
    'project:members:remove',
    'project:invites:list',
    'project:invites:revoke',
  ]),
  member: new Set([
    'project:read',
    'project:members:list',
    'project:invites:list',
  ]),
};

/** Check whether a role has a given permission. */
export function can(role: ProjectRole, permission: ProjectPermission): boolean {
  return PROJECT_PERMISSIONS[role].has(permission);
}