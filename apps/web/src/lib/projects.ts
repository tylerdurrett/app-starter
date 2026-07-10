import { apiFetch } from './api';
import type { ProjectRole } from './permissions';

export interface Project {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectWithRole extends Project {
  role: ProjectRole;
}

// Returned by GET /api/workspaces/:workspaceSlug/projects/:projectSlug — includes workspace context so the
// nav shell can render the parent workspace even when the user has project-only access.
export type ProjectWithWorkspace = ProjectWithRole;

export async function getLastActiveProject(): Promise<Project | null> {
  return apiFetch<Project | null>('/api/projects/last-active');
}

export async function listProjects(): Promise<ProjectWithRole[]> {
  return apiFetch<ProjectWithRole[]>('/api/projects');
}

export async function getProject(workspaceSlug: string, slug: string): Promise<ProjectWithWorkspace> {
  return apiFetch<ProjectWithWorkspace>(`/api/workspaces/${workspaceSlug}/projects/${slug}`);
}

export async function createProject(workspaceSlug: string, name: string): Promise<Project> {
  return apiFetch<Project>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ workspaceSlug, name }),
  });
}

export async function updateProject(workspaceSlug: string, slug: string, data: { name?: string }): Promise<Project> {
  return apiFetch<Project>(`/api/workspaces/${workspaceSlug}/projects/${slug}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteProject(workspaceSlug: string, slug: string, confirmation: string): Promise<void> {
  await apiFetch<void>(`/api/workspaces/${workspaceSlug}/projects/${slug}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmation }),
  });
}

// --- Members ---

export interface ProjectMember {
  userId: string;
  role: ProjectRole;
  createdAt: string;
  name: string;
  email: string;
}

export async function listProjectMembers(workspaceSlug: string, slug: string): Promise<ProjectMember[]> {
  return apiFetch<ProjectMember[]>(`/api/workspaces/${workspaceSlug}/projects/${slug}/members`);
}

export async function removeProjectMember(workspaceSlug: string, slug: string, userId: string): Promise<void> {
  await apiFetch<void>(`/api/workspaces/${workspaceSlug}/projects/${slug}/members/${userId}`, {
    method: 'DELETE',
  });
}

// --- Invites ---

export type ProjectInviteStatus = 'pending' | 'accepted' | 'revoked';

export interface ProjectInvite {
  id: string;
  email: string;
  role: string;
  status: ProjectInviteStatus;
  expiresAt: string;
  createdAt: string;
  invitedByName: string;
}

export interface ProjectInviteCreateResult {
  invite: ProjectInvite;
  inviteUrl: string;
}

export async function listProjectInvites(workspaceSlug: string, slug: string): Promise<ProjectInvite[]> {
  return apiFetch<ProjectInvite[]>(`/api/workspaces/${workspaceSlug}/projects/${slug}/invites`);
}

export async function createProjectInvite(workspaceSlug: string, slug: string, email: string, role?: 'manager' | 'member'): Promise<ProjectInviteCreateResult> {
  return apiFetch<ProjectInviteCreateResult>(`/api/workspaces/${workspaceSlug}/projects/${slug}/invites`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

export async function revokeProjectInvite(workspaceSlug: string, slug: string, inviteId: string): Promise<void> {
  await apiFetch<void>(`/api/workspaces/${workspaceSlug}/projects/${slug}/invites/${inviteId}/revoke`, {
    method: 'POST',
  });
}

// --- Token-based Invites ---

export interface ProjectInviteMetadata {
  inviteId: string;
  email: string;
  status: ProjectInviteStatus;
  expiresAt: string;
  projectName: string;
  projectSlug: string;
  workspaceName: string;
  workspaceSlug: string;
}

export async function getProjectInviteByToken(token: string): Promise<ProjectInviteMetadata> {
  return apiFetch<ProjectInviteMetadata>(`/api/project-invites/${token}`);
}

export async function acceptProjectInviteByToken(token: string): Promise<{ projectId: string; projectSlug: string }> {
  return apiFetch<{ projectId: string; projectSlug: string }>(`/api/project-invites/${token}/accept`, {
    method: 'POST',
  });
}