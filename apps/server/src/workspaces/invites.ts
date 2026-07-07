import { db, workspaceInvites, workspaceMemberships, workspaces, users } from '@repo/db';
import { eq, and } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';
import { resolveWorkspaceAndRole, ServiceError } from './service.js';
import type { WorkspaceRole } from './permissions.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function listInvites(slug: string, actorUserId: string) {
  const { workspace } = await resolveWorkspaceAndRole(slug, actorUserId, 'workspace:invites:list');

  return db
    .select({
      id: workspaceInvites.id,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      status: workspaceInvites.status,
      expiresAt: workspaceInvites.expiresAt,
      createdAt: workspaceInvites.createdAt,
      invitedByName: users.name,
    })
    .from(workspaceInvites)
    .innerJoin(users, eq(workspaceInvites.invitedByUserId, users.id))
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspace.id),
        eq(workspaceInvites.status, 'pending'),
      ),
    );
}

export async function createInvite(
  slug: string,
  actorUserId: string,
  { email, role = 'member' }: { email: string; role?: 'manager' | 'member' },
) {
  const { workspace } = await resolveWorkspaceAndRole(slug, actorUserId, 'workspace:members:invite');
  const normalizedEmail = email.toLowerCase().trim();

  // Check if email is already a member
  const [existingMember] = await db
    .select({ userId: workspaceMemberships.userId })
    .from(workspaceMemberships)
    .innerJoin(users, eq(workspaceMemberships.userId, users.id))
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspace.id),
        eq(users.email, normalizedEmail),
      ),
    );

  if (existingMember) {
    throw new ServiceError('CONFLICT', 'User is already a member of this workspace');
  }

  // Check for existing pending invite
  const [existingInvite] = await db
    .select({ id: workspaceInvites.id })
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.workspaceId, workspace.id),
        eq(workspaceInvites.email, normalizedEmail),
        eq(workspaceInvites.status, 'pending'),
      ),
    );

  if (existingInvite) {
    throw new ServiceError('CONFLICT', 'A pending invite already exists for this email');
  }

  const rawToken = randomUUID();
  const tokenHash = hashToken(rawToken);
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const [invite] = await db.insert(workspaceInvites).values({
    id,
    workspaceId: workspace.id,
    email: normalizedEmail,
    role,
    tokenHash,
    status: 'pending',
    invitedByUserId: actorUserId,
    expiresAt,
  }).returning();

  return { invite, token: rawToken };
}

export async function revokeInvite(slug: string, actorUserId: string, inviteId: string) {
  const { workspace } = await resolveWorkspaceAndRole(slug, actorUserId, 'workspace:invites:revoke');

  const [invite] = await db
    .select()
    .from(workspaceInvites)
    .where(
      and(
        eq(workspaceInvites.id, inviteId),
        eq(workspaceInvites.workspaceId, workspace.id),
      ),
    );

  if (!invite) throw new ServiceError('NOT_FOUND', 'Invite not found');

  if (invite.status !== 'pending') {
    throw new ServiceError('CONFLICT', 'Invite is not pending');
  }

  await db
    .update(workspaceInvites)
    .set({ status: 'revoked' })
    .where(eq(workspaceInvites.id, inviteId));
}

export async function getInviteByToken(token: string) {
  const tokenHash = hashToken(token);

  const [invite] = await db
    .select({
      id: workspaceInvites.id,
      workspaceId: workspaceInvites.workspaceId,
      email: workspaceInvites.email,
      role: workspaceInvites.role,
      status: workspaceInvites.status,
      expiresAt: workspaceInvites.expiresAt,
      workspaceName: workspaces.name,
      workspaceSlug: workspaces.slug,
    })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaceInvites.workspaceId, workspaces.id))
    .where(eq(workspaceInvites.tokenHash, tokenHash));

  if (!invite) {
    throw new ServiceError('NOT_FOUND', 'Invite not found');
  }

  // Intentionally return metadata for revoked/accepted/expired invites so the
  // invite landing page can render an explicit terminal-state card. Acceptance
  // validity is enforced in acceptInvite below.
  return invite;
}

export async function acceptInvite(token: string, actorUserId: string) {
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

  // Verify actor's email matches invite email
  const [actor] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, actorUserId));

  if (!actor) throw new ServiceError('NOT_FOUND', 'User not found');

  if (actor.email.toLowerCase().trim() !== invite.email) {
    throw new ServiceError('FORBIDDEN', 'This invite is for a different email address');
  }

  // Check if already a member
  const [existingMembership] = await db
    .select()
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, invite.workspaceId),
        eq(workspaceMemberships.userId, actorUserId),
      ),
    );

  if (existingMembership) {
    throw new ServiceError('CONFLICT', 'You are already a member of this workspace');
  }

  // Insert membership + mark invite accepted in one transaction
  await db.transaction(async (tx) => {
    await tx.insert(workspaceMemberships).values({
      id: randomUUID(),
      workspaceId: invite.workspaceId,
      userId: actorUserId,
      role: invite.role as WorkspaceRole,
    });

    await tx
      .update(workspaceInvites)
      .set({ status: 'accepted' })
      .where(eq(workspaceInvites.id, invite.id));
  });

  return {
    workspaceId: invite.workspaceId,
    workspaceSlug: invite.workspaceSlug,
    workspaceName: invite.workspaceName,
  };
}
