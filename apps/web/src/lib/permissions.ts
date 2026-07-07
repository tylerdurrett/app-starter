// Workspace permissions
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

const WORKSPACE_PERMISSIONS: Record<WorkspaceRole, Set<WorkspacePermission>> = {
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

/** Check whether a role has a given workspace permission. Mirrors server-side permissions. */
export function canWorkspace(role: WorkspaceRole, permission: WorkspacePermission): boolean {
  return WORKSPACE_PERMISSIONS[role]?.has(permission) ?? false;
}

// Project permissions
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

const PROJECT_PERMISSIONS: Record<ProjectRole, Set<ProjectPermission>> = {
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

/** Check whether a role has a given project permission. Mirrors server-side permissions. */
export function canProject(role: ProjectRole, permission: ProjectPermission): boolean {
  return PROJECT_PERMISSIONS[role]?.has(permission) ?? false;
}

// Legacy support - will be removed after full migration
// Map old permission names to new ones for backward compatibility
export function can(role: WorkspaceRole, permission: string): boolean {
  // For backwards compatibility, map old permission names to workspace permissions
  if (permission === 'members:remove') {
    return canWorkspace(role, 'workspace:members:remove');
  }
  if (permission === 'invites:create') {
    return canWorkspace(role, 'workspace:members:invite');
  }
  if (permission === 'invites:revoke') {
    return canWorkspace(role, 'workspace:invites:revoke');
  }
  if (permission === 'members:list') {
    return canWorkspace(role, 'workspace:members:list');
  }

  // Try as-is for other permissions
  return canWorkspace(role, permission as WorkspacePermission);
}