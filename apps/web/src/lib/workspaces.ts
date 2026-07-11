import { apiFetch, apiFetchParsed } from './api';
import {
  workspaceSchema,
  workspaceWithRoleSchema,
  workspaceMemberSchema,
  workspaceInviteSchema,
  workspaceInviteCreateResultSchema,
  workspaceInviteMetadataSchema,
  workspaceInviteAcceptResultSchema,
  type Workspace,
  type WorkspaceWithRole,
  type WorkspaceMember,
  type WorkspaceInvite,
  type WorkspaceInviteStatus,
  type WorkspaceInviteCreateResult,
  type WorkspaceInviteMetadata,
  type WorkspaceInviteAcceptResult,
} from '@repo/shared';
import type { ProjectWithRole } from './projects';

// Response types are inferred from the shared API-contract schemas
// (@repo/shared) — the single source of truth for these shapes.
export type {
  Workspace,
  WorkspaceWithRole,
  WorkspaceMember,
  WorkspaceInvite,
  WorkspaceInviteStatus,
  WorkspaceInviteCreateResult,
  WorkspaceInviteMetadata,
};

export async function createWorkspace(name: string): Promise<Workspace> {
  return apiFetchParsed('/api/workspaces', workspaceSchema, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function listWorkspaces(): Promise<WorkspaceWithRole[]> {
  return apiFetchParsed('/api/workspaces', workspaceWithRoleSchema.array());
}

export async function getWorkspace(slug: string): Promise<WorkspaceWithRole> {
  return apiFetchParsed(`/api/workspaces/${slug}`, workspaceWithRoleSchema);
}

export async function updateWorkspace(slug: string, name: string): Promise<Workspace> {
  return apiFetchParsed(`/api/workspaces/${slug}`, workspaceSchema, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function deleteWorkspace(slug: string, confirmation: string): Promise<void> {
  await apiFetch<void>(`/api/workspaces/${slug}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmation }),
  });
}

// --- Members ---

export async function listWorkspaceMembers(slug: string): Promise<WorkspaceMember[]> {
  return apiFetchParsed(`/api/workspaces/${slug}/members`, workspaceMemberSchema.array());
}

export async function removeWorkspaceMember(slug: string, userId: string): Promise<void> {
  await apiFetch<void>(`/api/workspaces/${slug}/members/${userId}`, {
    method: 'DELETE',
  });
}

// --- Invites ---

export async function listWorkspaceInvites(slug: string): Promise<WorkspaceInvite[]> {
  return apiFetchParsed(`/api/workspaces/${slug}/invites`, workspaceInviteSchema.array());
}

export async function createWorkspaceInvite(slug: string, email: string, role: 'manager' | 'member'): Promise<WorkspaceInviteCreateResult> {
  return apiFetchParsed(`/api/workspaces/${slug}/invites`, workspaceInviteCreateResultSchema, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

export async function revokeWorkspaceInvite(slug: string, inviteId: string): Promise<void> {
  await apiFetch<void>(`/api/workspaces/${slug}/invites/${inviteId}/revoke`, {
    method: 'POST',
  });
}

// --- Token-based Invites ---

export async function getWorkspaceInviteByToken(token: string): Promise<WorkspaceInviteMetadata> {
  return apiFetchParsed(`/api/workspace-invites/${token}`, workspaceInviteMetadataSchema);
}

export async function acceptWorkspaceInviteByToken(token: string): Promise<WorkspaceInviteAcceptResult> {
  return apiFetchParsed(`/api/workspace-invites/${token}/accept`, workspaceInviteAcceptResultSchema, {
    method: 'POST',
  });
}

// --- Projects ---

export async function listProjectsForWorkspace(slug: string): Promise<ProjectWithRole[]> {
  return apiFetch<ProjectWithRole[]>(`/api/workspaces/${slug}/projects`);
}
