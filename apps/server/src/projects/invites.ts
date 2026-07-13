import { db, projectInvites, projectMemberships, projects, workspaces } from '@repo/db';
import { eq } from 'drizzle-orm';
import {
  listInvites as sharedListInvites,
  createInvite as sharedCreateInvite,
  revokeInvite as sharedRevokeInvite,
  getInviteByToken as sharedGetInviteByToken,
  acceptInvite as sharedAcceptInvite,
  type InviteLifecycleConfig,
  type ResolveEntity,
} from '../tenancy/index.js';
import { resolveProjectAndRole } from './service.js';
import type { ProjectPermission } from './permissions.js';
import { projectInviteMetadataSchema, type ProjectInviteMetadata } from '@repo/shared';

/** Token-metadata projection returned by getInviteByToken for the project level. */
interface ProjectInviteTokenMeta {
  id: string;
  projectId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  projectName: string;
  projectSlug: string;
  workspaceName: string;
  workspaceSlug: string;
}

interface ProjectAcceptResult {
  projectId: string;
  projectSlug: string;
}

const config: InviteLifecycleConfig<
  ProjectPermission,
  ProjectInviteTokenMeta,
  ProjectInviteMetadata,
  ProjectAcceptResult
> = {
  entityLabel: 'project',
  permissions: {
    list: 'project:invites:list',
    invite: 'project:members:invite',
    revoke: 'project:invites:revoke',
  },
  invites: {
    table: projectInvites,
    id: projectInvites.id,
    email: projectInvites.email,
    role: projectInvites.role,
    status: projectInvites.status,
    expiresAt: projectInvites.expiresAt,
    createdAt: projectInvites.createdAt,
    invitedByUserId: projectInvites.invitedByUserId,
    entityId: projectInvites.projectId,
    entityIdKey: 'projectId',
  },
  memberships: {
    table: projectMemberships,
    userId: projectMemberships.userId,
    entityId: projectMemberships.projectId,
    entityIdKey: 'projectId',
  },
  async selectByTokenHash(tokenHash) {
    const [invite] = await db
      .select({
        id: projectInvites.id,
        projectId: projectInvites.projectId,
        email: projectInvites.email,
        role: projectInvites.role,
        status: projectInvites.status,
        expiresAt: projectInvites.expiresAt,
        projectName: projects.name,
        projectSlug: projects.slug,
        workspaceName: workspaces.name,
        workspaceSlug: workspaces.slug,
      })
      .from(projectInvites)
      .innerJoin(projects, eq(projectInvites.projectId, projects.id))
      .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
      .where(eq(projectInvites.tokenHash, tokenHash));
    return invite;
  },
  buildTokenMetadata: (invite) =>
    projectInviteMetadataSchema.parse({
      inviteId: invite.id,
      email: invite.email,
      status: invite.status,
      expiresAt: invite.expiresAt.toISOString(),
      projectName: invite.projectName,
      projectSlug: invite.projectSlug,
      workspaceName: invite.workspaceName,
      workspaceSlug: invite.workspaceSlug,
    }),
  membershipEntityId: (invite) => invite.projectId,
  buildAcceptResult: (invite) => ({
    projectId: invite.projectId,
    projectSlug: invite.projectSlug,
  }),
};

function resolveProject(
  slug: string,
  actorUserId: string,
  workspaceSlug: string,
): ResolveEntity<ProjectPermission> {
  return (permission) =>
    resolveProjectAndRole(slug, actorUserId, permission, workspaceSlug).then((r) => r.project);
}

export function listInvites(slug: string, actorUserId: string, workspaceSlug: string) {
  return sharedListInvites(config, resolveProject(slug, actorUserId, workspaceSlug));
}

export function createInvite(
  slug: string,
  actorUserId: string,
  input: { email: string; role?: 'manager' | 'member' },
  workspaceSlug: string,
) {
  return sharedCreateInvite(
    config,
    resolveProject(slug, actorUserId, workspaceSlug),
    actorUserId,
    input,
  );
}

export function revokeInvite(
  slug: string,
  actorUserId: string,
  inviteId: string,
  workspaceSlug: string,
): Promise<void> {
  return sharedRevokeInvite(config, resolveProject(slug, actorUserId, workspaceSlug), inviteId);
}

export function getInviteByToken(token: string) {
  return sharedGetInviteByToken(config, token);
}

export function acceptInvite(token: string, userId: string) {
  return sharedAcceptInvite(config, token, userId);
}
