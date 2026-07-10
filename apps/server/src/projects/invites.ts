import { db, projectInvites, projectMemberships, projects, users, workspaces } from '@repo/db';
import { eq, and } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';
import { resolveProjectAndRole, ServiceError } from './service.js';
import type { ProjectRole } from './permissions.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function listInvites(slug: string, actorUserId: string, workspaceSlug: string) {
  const { project } = await resolveProjectAndRole(
    slug,
    actorUserId,
    'project:invites:list',
    workspaceSlug,
  );

  return db
    .select({
      id: projectInvites.id,
      email: projectInvites.email,
      role: projectInvites.role,
      status: projectInvites.status,
      expiresAt: projectInvites.expiresAt,
      createdAt: projectInvites.createdAt,
      invitedByName: users.name,
    })
    .from(projectInvites)
    .innerJoin(users, eq(projectInvites.invitedByUserId, users.id))
    .where(
      and(
        eq(projectInvites.projectId, project.id),
        eq(projectInvites.status, 'pending'),
      ),
    );
}

export async function createInvite(
  slug: string,
  actorUserId: string,
  { email, role = 'member' }: { email: string; role?: 'manager' | 'member' },
  workspaceSlug: string,
) {
  const { project } = await resolveProjectAndRole(
    slug,
    actorUserId,
    'project:members:invite',
    workspaceSlug,
  );
  const normalizedEmail = email.toLowerCase().trim();

  // Check if email is already a member
  const [existingMember] = await db
    .select({ userId: projectMemberships.userId })
    .from(projectMemberships)
    .innerJoin(users, eq(projectMemberships.userId, users.id))
    .where(
      and(
        eq(projectMemberships.projectId, project.id),
        eq(users.email, normalizedEmail),
      ),
    );

  if (existingMember) {
    throw new ServiceError('CONFLICT', 'User is already a member of this project');
  }

  // Check for existing pending invite
  const [existingInvite] = await db
    .select({ id: projectInvites.id })
    .from(projectInvites)
    .where(
      and(
        eq(projectInvites.projectId, project.id),
        eq(projectInvites.email, normalizedEmail),
        eq(projectInvites.status, 'pending'),
      ),
    );

  if (existingInvite) {
    throw new ServiceError('CONFLICT', 'A pending invite already exists for this email');
  }

  const rawToken = randomUUID();
  const tokenHash = hashToken(rawToken);
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const [invite] = await db.insert(projectInvites).values({
    id,
    projectId: project.id,
    email: normalizedEmail,
    role,
    tokenHash,
    status: 'pending',
    invitedByUserId: actorUserId,
    expiresAt,
  }).returning();

  return { invite, token: rawToken };
}

export async function revokeInvite(
  slug: string,
  actorUserId: string,
  inviteId: string,
  workspaceSlug: string,
) {
  const { project } = await resolveProjectAndRole(
    slug,
    actorUserId,
    'project:invites:revoke',
    workspaceSlug,
  );

  const [invite] = await db
    .select()
    .from(projectInvites)
    .where(
      and(
        eq(projectInvites.id, inviteId),
        eq(projectInvites.projectId, project.id),
        eq(projectInvites.status, 'pending'),
      ),
    );

  if (!invite) {
    throw new ServiceError('NOT_FOUND', 'Invite not found');
  }

  const [updated] = await db
    .update(projectInvites)
    .set({ status: 'revoked' })
    .where(eq(projectInvites.id, inviteId))
    .returning();

  return updated;
}

export async function getInviteByToken(token: string) {
  const tokenHash = hashToken(token);

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

  if (!invite) {
    throw new ServiceError('NOT_FOUND', 'Invite not found');
  }

  // Intentionally return metadata for revoked/accepted/expired invites so the
  // invite landing page can render an explicit terminal-state card. Acceptance
  // validity is enforced in acceptInvite below.
  return invite;
}

export async function acceptInvite(token: string, userId: string) {
  const invite = await getInviteByToken(token);

  if (invite.status === 'accepted') {
    throw new ServiceError('CONFLICT', 'This invite has already been accepted');
  }
  if (invite.status === 'revoked') {
    throw new ServiceError('CONFLICT', 'This invite has been revoked');
  }
  if (invite.expiresAt < new Date()) {
    throw new ServiceError('CONFLICT', 'This invite has expired');
  }

  // Verify the accepting user's email matches
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!user || user.email !== invite.email) {
    throw new ServiceError('FORBIDDEN', 'This invite is for a different email address');
  }

  // Check if already a member
  const [existingMembership] = await db
    .select()
    .from(projectMemberships)
    .where(
      and(
        eq(projectMemberships.projectId, invite.projectId),
        eq(projectMemberships.userId, userId),
      ),
    );

  if (existingMembership) {
    throw new ServiceError('CONFLICT', 'You are already a member of this project');
  }

  // Accept the invite and create membership in a transaction
  await db.transaction(async (tx) => {
    await tx
      .update(projectInvites)
      .set({ status: 'accepted' })
      .where(eq(projectInvites.id, invite.id));

    await tx.insert(projectMemberships).values({
      id: randomUUID(),
      projectId: invite.projectId,
      userId,
      role: invite.role as ProjectRole,
    });
  });

  return {
    projectSlug: invite.projectSlug,
    projectName: invite.projectName,
  };
}