import { apiFetch, apiFetchParsed } from './api';
import {
  projectSchema,
  projectWithRoleSchema,
  projectMemberSchema,
  projectInviteSchema,
  projectInviteCreateResultSchema,
  projectInviteMetadataSchema,
  projectInviteAcceptResultSchema,
  type Project,
  type ProjectWithRole,
  type ProjectWithWorkspace,
  type ProjectMember,
  type ProjectInvite,
  type ProjectInviteStatus,
  type ProjectInviteCreateResult,
  type ProjectInviteMetadata,
} from '@repo/shared';

// Response types are inferred from the shared API-contract schemas
// (@repo/shared) — the single source of truth for these shapes.
export type {
  Project,
  ProjectWithRole,
  ProjectWithWorkspace,
  ProjectMember,
  ProjectInvite,
  ProjectInviteStatus,
  ProjectInviteCreateResult,
  ProjectInviteMetadata,
};

export async function getLastActiveProject(): Promise<Project | null> {
  return apiFetchParsed('/api/projects/last-active', projectSchema.nullable());
}

export async function listProjects(): Promise<ProjectWithRole[]> {
  return apiFetchParsed('/api/projects', projectWithRoleSchema.array());
}

export async function getProject(workspaceSlug: string, slug: string): Promise<ProjectWithWorkspace> {
  return apiFetchParsed(`/api/workspaces/${workspaceSlug}/projects/${slug}`, projectWithRoleSchema);
}

export async function createProject(workspaceSlug: string, name: string): Promise<Project> {
  return apiFetchParsed('/api/projects', projectSchema, {
    method: 'POST',
    body: JSON.stringify({ workspaceSlug, name }),
  });
}

export async function updateProject(workspaceSlug: string, slug: string, data: { name?: string }): Promise<Project> {
  return apiFetchParsed(`/api/workspaces/${workspaceSlug}/projects/${slug}`, projectSchema, {
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

export async function listProjectMembers(workspaceSlug: string, slug: string): Promise<ProjectMember[]> {
  return apiFetchParsed(`/api/workspaces/${workspaceSlug}/projects/${slug}/members`, projectMemberSchema.array());
}

export async function removeProjectMember(workspaceSlug: string, slug: string, userId: string): Promise<void> {
  await apiFetch<void>(`/api/workspaces/${workspaceSlug}/projects/${slug}/members/${userId}`, {
    method: 'DELETE',
  });
}

// --- Invites ---

export async function listProjectInvites(workspaceSlug: string, slug: string): Promise<ProjectInvite[]> {
  return apiFetchParsed(`/api/workspaces/${workspaceSlug}/projects/${slug}/invites`, projectInviteSchema.array());
}

export async function createProjectInvite(workspaceSlug: string, slug: string, email: string, role?: 'manager' | 'member'): Promise<ProjectInviteCreateResult> {
  return apiFetchParsed(`/api/workspaces/${workspaceSlug}/projects/${slug}/invites`, projectInviteCreateResultSchema, {
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

export async function getProjectInviteByToken(token: string): Promise<ProjectInviteMetadata> {
  return apiFetchParsed(`/api/project-invites/${token}`, projectInviteMetadataSchema);
}

export async function acceptProjectInviteByToken(token: string): Promise<{ projectId: string; projectSlug: string }> {
  return apiFetchParsed(`/api/project-invites/${token}/accept`, projectInviteAcceptResultSchema, {
    method: 'POST',
  });
}
