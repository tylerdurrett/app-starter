import { db, users } from '@repo/db';
import { eq, and } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { randomUUID, createHash } from 'node:crypto';
import { ServiceError } from './errors.js';
import type { TenancyRole } from './roles.js';

/** Invites are valid for 7 days from creation. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hash an invite token for at-rest storage/lookup (raw token is never persisted). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Common invite fields every level's token-metadata projection must include. */
export interface InviteTokenMeta {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
}

/** Resolve the entity (running the level's permission check) for one operation. */
export type ResolveEntity<Permission extends string> = (
  permission: Permission,
) => Promise<{ id: string }>;

/**
 * Per-level configuration for the shared invite lifecycle. Everything that
 * differs between the workspace and project levels is expressed here — table
 * set, entity-id columns, permission strings, token-metadata projection, and
 * the two divergent guards (revoke + email) — so the five operations below can
 * hold the shared control flow and error semantics exactly once.
 */
export interface InviteLifecycleConfig<
  Permission extends string,
  TokenMeta extends InviteTokenMeta,
  AcceptResult,
> {
  /** Label used in conflict messages, e.g. 'workspace' | 'project'. */
  entityLabel: string;
  /** Permission strings checked when resolving the entity per operation. */
  permissions: { list: Permission; invite: Permission; revoke: Permission };
  /** The invites table plus the columns the shared queries touch. */
  invites: {
    table: PgTable;
    id: PgColumn;
    email: PgColumn;
    role: PgColumn;
    status: PgColumn;
    expiresAt: PgColumn;
    createdAt: PgColumn;
    invitedByUserId: PgColumn;
    /** Entity FK column (workspaceId | projectId) for WHERE filters. */
    entityId: PgColumn;
    /** Insert-model key for the entity FK (e.g. 'workspaceId' | 'projectId'). */
    entityIdKey: string;
  };
  /** The memberships table plus the columns the shared queries touch. */
  memberships: {
    table: PgTable;
    userId: PgColumn;
    /** Entity FK column (workspaceId | projectId) for WHERE filters. */
    entityId: PgColumn;
    /** Insert-model key for the entity FK (e.g. 'workspaceId' | 'projectId'). */
    entityIdKey: string;
  };
  /**
   * Load the token-metadata projection for a token hash. DIVERGENT join shape:
   * workspace joins `workspaces`; project joins `projects` then the parent
   * `workspaces`. Returns undefined when no invite matches the hash.
   */
  selectByTokenHash(tokenHash: string): Promise<TokenMeta | undefined>;
  /**
   * Revoke an invite. DIVERGENT not-found/conflict semantics and return shape:
   * workspace fetches by (id, entity) with no status filter then throws
   * CONFLICT on a non-pending invite and returns void; project fetches by
   * (id, entity, status='pending'), throws NOT_FOUND when absent, and returns
   * the updated row via `.returning()`.
   */
  revoke(entityId: string, inviteId: string): Promise<unknown>;
  /**
   * Verify the accepting user's email matches the invite. DIVERGENT missing-user
   * handling and normalization: workspace normalizes the stored email and
   * throws NOT_FOUND for a missing user; project compares raw and folds a
   * missing user into the FORBIDDEN branch.
   */
  emailGuard(userId: string, inviteEmail: string): Promise<void>;
  /** The entity id the accepting user becomes a member of. */
  membershipEntityId(invite: TokenMeta): string;
  /** The accept() return projection for this level. */
  buildAcceptResult(invite: TokenMeta): AcceptResult;
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** List pending invites for the resolved entity. */
export async function listInvites<
  Permission extends string,
  TokenMeta extends InviteTokenMeta,
  AcceptResult,
>(
  config: InviteLifecycleConfig<Permission, TokenMeta, AcceptResult>,
  resolveEntity: ResolveEntity<Permission>,
) {
  const { id: entityId } = await resolveEntity(config.permissions.list);

  return db
    .select({
      id: config.invites.id,
      email: config.invites.email,
      role: config.invites.role,
      status: config.invites.status,
      expiresAt: config.invites.expiresAt,
      createdAt: config.invites.createdAt,
      invitedByName: users.name,
    })
    .from(config.invites.table)
    .innerJoin(users, eq(config.invites.invitedByUserId, users.id))
    .where(and(eq(config.invites.entityId, entityId), eq(config.invites.status, 'pending')));
}

/** Create a pending invite after rejecting existing members and duplicate invites. */
export async function createInvite<
  Permission extends string,
  TokenMeta extends InviteTokenMeta,
  AcceptResult,
>(
  config: InviteLifecycleConfig<Permission, TokenMeta, AcceptResult>,
  resolveEntity: ResolveEntity<Permission>,
  actorUserId: string,
  { email, role = 'member' }: { email: string; role?: 'manager' | 'member' },
) {
  const { id: entityId } = await resolveEntity(config.permissions.invite);
  const normalizedEmail = email.toLowerCase().trim();

  // Check if email is already a member
  const [existingMember] = await db
    .select({ userId: config.memberships.userId })
    .from(config.memberships.table)
    .innerJoin(users, eq(config.memberships.userId, users.id))
    .where(and(eq(config.memberships.entityId, entityId), eq(users.email, normalizedEmail)));

  if (existingMember) {
    throw new ServiceError('CONFLICT', `User is already a member of this ${config.entityLabel}`);
  }

  // Check for existing pending invite
  const [existingInvite] = await db
    .select({ id: config.invites.id })
    .from(config.invites.table)
    .where(
      and(
        eq(config.invites.entityId, entityId),
        eq(config.invites.email, normalizedEmail),
        eq(config.invites.status, 'pending'),
      ),
    );

  if (existingInvite) {
    throw new ServiceError('CONFLICT', 'A pending invite already exists for this email');
  }

  const rawToken = randomUUID();
  const tokenHash = hashToken(rawToken);
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const values = {
    id,
    [config.invites.entityIdKey]: entityId,
    email: normalizedEmail,
    role,
    tokenHash,
    status: 'pending',
    invitedByUserId: actorUserId,
    expiresAt,
    // Cast required because the level-agnostic config types its tables as bare
    // `PgTable` (no row model). Accepted deliberately — see #66.
  } as typeof config.invites.table.$inferInsert;

  const [invite] = await db.insert(config.invites.table).values(values).returning();

  return { invite, token: rawToken };
}

/** Revoke an invite for the resolved entity (semantics/return shape are DIVERGENT). */
export async function revokeInvite<
  Permission extends string,
  TokenMeta extends InviteTokenMeta,
  AcceptResult,
>(
  config: InviteLifecycleConfig<Permission, TokenMeta, AcceptResult>,
  resolveEntity: ResolveEntity<Permission>,
  inviteId: string,
) {
  const { id: entityId } = await resolveEntity(config.permissions.revoke);
  return config.revoke(entityId, inviteId);
}

/** Load invite metadata by raw token, including for terminal-state invites. */
export async function getInviteByToken<
  Permission extends string,
  TokenMeta extends InviteTokenMeta,
  AcceptResult,
>(config: InviteLifecycleConfig<Permission, TokenMeta, AcceptResult>, token: string) {
  const tokenHash = hashToken(token);
  const invite = await config.selectByTokenHash(tokenHash);

  if (!invite) {
    throw new ServiceError('NOT_FOUND', 'Invite not found');
  }

  // Intentionally return metadata for revoked/accepted/expired invites so the
  // invite landing page can render an explicit terminal-state card. Acceptance
  // validity is enforced in acceptInvite below.
  return invite;
}

/** Accept an invite: validate state + email, then join in a single transaction. */
export async function acceptInvite<
  Permission extends string,
  TokenMeta extends InviteTokenMeta,
  AcceptResult,
>(
  config: InviteLifecycleConfig<Permission, TokenMeta, AcceptResult>,
  token: string,
  actorUserId: string,
): Promise<AcceptResult> {
  const invite = await getInviteByToken(config, token);

  if (invite.status === 'accepted') {
    throw new ServiceError('CONFLICT', 'This invite has already been accepted');
  }
  if (invite.status === 'revoked') {
    throw new ServiceError('CONFLICT', 'This invite has been revoked');
  }
  if (invite.expiresAt < new Date()) {
    throw new ServiceError('CONFLICT', 'This invite has expired');
  }

  // Verify the accepting user's email matches the invite (DIVERGENT per level).
  await config.emailGuard(actorUserId, invite.email);

  const entityId = config.membershipEntityId(invite);

  // Check if already a member
  const [existingMembership] = await db
    .select()
    .from(config.memberships.table)
    .where(
      and(eq(config.memberships.entityId, entityId), eq(config.memberships.userId, actorUserId)),
    );

  if (existingMembership) {
    throw new ServiceError('CONFLICT', `You are already a member of this ${config.entityLabel}`);
  }

  // Insert membership + mark invite accepted in one transaction.
  await db.transaction(async (tx: DbTransaction) => {
    const membershipValues = {
      id: randomUUID(),
      [config.memberships.entityIdKey]: entityId,
      userId: actorUserId,
      role: invite.role as TenancyRole,
      // Cast required because the level-agnostic config types its tables as bare
      // `PgTable` (no row model). Accepted deliberately — see #66.
    } as typeof config.memberships.table.$inferInsert;

    await tx.insert(config.memberships.table).values(membershipValues);

    await tx
      .update(config.invites.table)
      .set({ status: 'accepted' })
      .where(eq(config.invites.id, invite.id));
  });

  return config.buildAcceptResult(invite);
}
