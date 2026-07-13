import { db, users } from '@repo/db';
import { eq, and } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { randomUUID, createHash } from 'node:crypto';
import { inviteBaseSchema, type InviteBase } from '@repo/shared';
import { ServiceError } from './errors.js';
import type { TenancyRole } from './roles.js';

/** Invites are valid for 7 days from creation. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hash an invite token for at-rest storage/lookup (raw token is never persisted). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Common invite fields every level's token-metadata projection must include. */
export interface InviteTokenRecord {
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
 * accept result — so the five operations below can hold shared control flow
 * and error semantics exactly once.
 */
export interface InviteLifecycleConfig<
  Permission extends string,
  TokenRecord extends InviteTokenRecord,
  TokenMetadata,
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
  selectByTokenHash(tokenHash: string): Promise<TokenRecord | undefined>;
  /** Project an internal token record onto the level-specific safe contract. */
  buildTokenMetadata(invite: TokenRecord): TokenMetadata;
  /** The entity id the accepting user becomes a member of. */
  membershipEntityId(invite: TokenRecord): string;
  /** The accept() return projection for this level. */
  buildAcceptResult(invite: TokenRecord): AcceptResult;
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** List pending invites for the resolved entity. */
export async function listInvites<
  Permission extends string,
  TokenRecord extends InviteTokenRecord,
  TokenMetadata,
  AcceptResult,
>(
  config: InviteLifecycleConfig<Permission, TokenRecord, TokenMetadata, AcceptResult>,
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
  TokenRecord extends InviteTokenRecord,
  TokenMetadata,
  AcceptResult,
>(
  config: InviteLifecycleConfig<Permission, TokenRecord, TokenMetadata, AcceptResult>,
  resolveEntity: ResolveEntity<Permission>,
  actorUserId: string,
  { email, role = 'member' }: { email: string; role?: 'manager' | 'member' },
): Promise<{ invite: InviteBase; token: string }> {
  const [inviter] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, actorUserId));

  if (!inviter) {
    throw new ServiceError('NOT_FOUND', 'Inviting user not found');
  }
  if (inviter.name === null) {
    throw new ServiceError('BAD_REQUEST', 'Inviting user must have a name');
  }

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

  const [inserted] = await db.insert(config.invites.table).values(values).returning({
    id: config.invites.id,
    email: config.invites.email,
    role: config.invites.role,
    status: config.invites.status,
    expiresAt: config.invites.expiresAt,
    createdAt: config.invites.createdAt,
  });

  if (!inserted) {
    throw new ServiceError('BAD_REQUEST', 'Invite could not be created');
  }

  const invite = inviteBaseSchema.parse({
    ...inserted,
    expiresAt: toIsoString(inserted.expiresAt),
    createdAt: toIsoString(inserted.createdAt),
    invitedByName: inviter.name,
  });

  return { invite, token: rawToken };
}

function toIsoString(value: unknown): string {
  if (!(value instanceof Date)) {
    throw new ServiceError('BAD_REQUEST', 'Invite timestamp is invalid');
  }
  return value.toISOString();
}

/** Revoke a pending invite for the resolved entity. */
export async function revokeInvite<
  Permission extends string,
  TokenRecord extends InviteTokenRecord,
  TokenMetadata,
  AcceptResult,
>(
  config: InviteLifecycleConfig<Permission, TokenRecord, TokenMetadata, AcceptResult>,
  resolveEntity: ResolveEntity<Permission>,
  inviteId: string,
): Promise<void> {
  const { id: entityId } = await resolveEntity(config.permissions.revoke);
  const [invite] = await db
    .select({ status: config.invites.status })
    .from(config.invites.table)
    .where(and(eq(config.invites.id, inviteId), eq(config.invites.entityId, entityId)));

  if (!invite) {
    throw new ServiceError('NOT_FOUND', 'Invite not found');
  }
  if (invite.status !== 'pending') {
    throw new ServiceError('CONFLICT', 'Invite is not pending');
  }

  await db
    .update(config.invites.table)
    .set({ status: 'revoked' })
    .where(eq(config.invites.id, inviteId));
}

/** Load the internal invite record needed for acceptance. */
async function loadInviteByToken<
  Permission extends string,
  TokenRecord extends InviteTokenRecord,
  TokenMetadata,
  AcceptResult,
>(
  config: InviteLifecycleConfig<Permission, TokenRecord, TokenMetadata, AcceptResult>,
  token: string,
): Promise<TokenRecord> {
  const tokenHash = hashToken(token);
  const invite = await config.selectByTokenHash(tokenHash);

  if (!invite) {
    throw new ServiceError('NOT_FOUND', 'Invite not found');
  }

  return invite;
}

/** Load safe invite metadata, including for terminal-state invites. */
export async function getInviteByToken<
  Permission extends string,
  TokenRecord extends InviteTokenRecord,
  TokenMetadata,
  AcceptResult,
>(
  config: InviteLifecycleConfig<Permission, TokenRecord, TokenMetadata, AcceptResult>,
  token: string,
): Promise<TokenMetadata> {
  return config.buildTokenMetadata(await loadInviteByToken(config, token));
}

/** Accept an invite: validate state + email, then join in a single transaction. */
export async function acceptInvite<
  Permission extends string,
  TokenRecord extends InviteTokenRecord,
  TokenMetadata,
  AcceptResult,
>(
  config: InviteLifecycleConfig<Permission, TokenRecord, TokenMetadata, AcceptResult>,
  token: string,
  actorUserId: string,
): Promise<AcceptResult> {
  const invite = await loadInviteByToken(config, token);

  if (invite.status === 'accepted') {
    throw new ServiceError('CONFLICT', 'This invite has already been accepted');
  }
  if (invite.status === 'revoked') {
    throw new ServiceError('CONFLICT', 'This invite has been revoked');
  }
  if (invite.expiresAt < new Date()) {
    throw new ServiceError('CONFLICT', 'This invite has expired');
  }

  const [actor] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, actorUserId));

  if (!actor) {
    throw new ServiceError('NOT_FOUND', 'User not found');
  }
  if (normalizeEmail(actor.email) !== normalizeEmail(invite.email)) {
    throw new ServiceError('FORBIDDEN', 'This invite is for a different email address');
  }

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

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}
