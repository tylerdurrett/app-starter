import { apiFetch } from './api';
import type { WorkspaceRole } from './permissions';
import type { ProjectWithRole } from './projects';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceWithRole extends Workspace {
  role: WorkspaceRole;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  return apiFetch<Workspace>('/api/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function listWorkspaces(): Promise<WorkspaceWithRole[]> {
  return apiFetch<WorkspaceWithRole[]>('/api/workspaces');
}

export async function getWorkspace(slug: string): Promise<WorkspaceWithRole> {
  return apiFetch<WorkspaceWithRole>(`/api/workspaces/${slug}`);
}

export async function updateWorkspace(slug: string, name: string): Promise<Workspace> {
  return apiFetch<Workspace>(`/api/workspaces/${slug}`, {
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

export interface WorkspaceMember {
  userId: string;
  role: WorkspaceRole;
  createdAt: string;
  name: string;
  email: string;
}

export async function listWorkspaceMembers(slug: string): Promise<WorkspaceMember[]> {
  return apiFetch<WorkspaceMember[]>(`/api/workspaces/${slug}/members`);
}

export async function removeWorkspaceMember(slug: string, userId: string): Promise<void> {
  await apiFetch<void>(`/api/workspaces/${slug}/members/${userId}`, {
    method: 'DELETE',
  });
}

// --- Invites ---

export type WorkspaceInviteStatus = 'pending' | 'accepted' | 'revoked';

export interface WorkspaceInvite {
  id: string;
  email: string;
  role: 'manager' | 'member';
  status: WorkspaceInviteStatus;
  expiresAt: string;
  createdAt: string;
  invitedByName: string;
}

export interface WorkspaceInviteCreateResult {
  invite: WorkspaceInvite;
  inviteUrl: string;
}

export async function listWorkspaceInvites(slug: string): Promise<WorkspaceInvite[]> {
  return apiFetch<WorkspaceInvite[]>(`/api/workspaces/${slug}/invites`);
}

export async function createWorkspaceInvite(slug: string, email: string, role: 'manager' | 'member'): Promise<WorkspaceInviteCreateResult> {
  return apiFetch<WorkspaceInviteCreateResult>(`/api/workspaces/${slug}/invites`, {
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

export interface WorkspaceInviteMetadata {
  inviteId: string;
  email: string;
  status: WorkspaceInviteStatus;
  expiresAt: string;
  workspaceName: string;
  workspaceSlug: string;
}

export async function getWorkspaceInviteByToken(token: string): Promise<WorkspaceInviteMetadata> {
  return apiFetch<WorkspaceInviteMetadata>(`/api/workspace-invites/${token}`);
}

export async function acceptWorkspaceInviteByToken(token: string): Promise<{ workspaceId: string; workspaceSlug: string; workspaceName: string }> {
  return apiFetch<{ workspaceId: string; workspaceSlug: string; workspaceName: string }>(`/api/workspace-invites/${token}/accept`, {
    method: 'POST',
  });
}

// --- Projects ---

export async function listProjectsForWorkspace(slug: string): Promise<ProjectWithRole[]> {
  return apiFetch<ProjectWithRole[]>(`/api/workspaces/${slug}/projects`);
}