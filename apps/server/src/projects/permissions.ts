import { can as sharedCan } from '../tenancy/index.js';
import type { PermissionMatrix, TenancyRole } from '../tenancy/index.js';

export type ProjectRole = TenancyRole;

export type ProjectPermission =
  | 'project:read'
  | 'project:edit'
  | 'project:delete'
  | 'project:members:list'
  | 'project:members:invite'
  | 'project:members:remove'
  | 'project:invites:list'
  | 'project:invites:revoke';

export const PROJECT_PERMISSIONS: PermissionMatrix<ProjectPermission> = {
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
  return sharedCan(PROJECT_PERMISSIONS, role, permission);
}