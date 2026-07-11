import { db, users } from '@repo/db';
import { eq, and } from 'drizzle-orm';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { ServiceError } from './errors.js';
import type { TenancyRole } from './roles.js';

/** The ServiceError code union, reused for the divergent self-removal error. */
type ServiceErrorCode = ConstructorParameters<typeof ServiceError>[0];

/**
 * Resolve the entity (running the level's permission check) for a member
 * operation. Unlike the invite resolver this also surfaces the actor's own
 * role, which `removeMember`'s owner guard needs.
 */
export type ResolveMemberEntity<Permission extends string> = (
  permission: Permission,
) => Promise<{ id: string; role: TenancyRole }>;

/**
 * Per-level configuration for the shared member-CRUD flow. Everything that
 * differs between the workspace and project levels lives here — the memberships
 * table + columns the shared queries touch, the two permission strings, and the
 * two divergent relational rules (the self-removal error code/message and the
 * optional owner guard) — so `listMembers` and `removeMember` can hold the
 * shared control flow and error semantics exactly once.
 */
export interface MemberCrudConfig<Permission extends string> {
  /** Permission strings checked when resolving the entity per operation. */
  permissions: { list: Permission; remove: Permission };
  /** The memberships table plus the columns the shared queries touch. */
  memberships: {
    table: PgTable;
    userId: PgColumn;
    role: PgColumn;
    createdAt: PgColumn;
    /** Entity FK column (workspaceId | projectId) for WHERE filters. */
    entityId: PgColumn;
  };
  /**
   * DIVERGENT self-removal rejection: workspace throws BAD_REQUEST 'Cannot
   * remove yourself'; project throws CONFLICT 'You cannot remove yourself from
   * the project'.
   */
  selfRemovalError: { code: ServiceErrorCode; message: string };
  /**
   * DIVERGENT relational guard run after the target membership is fetched, with
   * the actor's role and the target's role. Workspace forbids a manager
   * removing the owner (BAD_REQUEST); project supplies none.
   */
  ownerGuard?: (actorRole: TenancyRole, targetRole: TenancyRole) => void;
}

/** List members for the resolved entity, joined to the owning users. */
export async function listMembers<Permission extends string>(
  config: MemberCrudConfig<Permission>,
  resolveEntity: ResolveMemberEntity<Permission>,
) {
  const { id: entityId } = await resolveEntity(config.permissions.list);

  return db
    .select({
      userId: config.memberships.userId,
      role: config.memberships.role,
      createdAt: config.memberships.createdAt,
      name: users.name,
      email: users.email,
    })
    .from(config.memberships.table)
    .innerJoin(users, eq(config.memberships.userId, users.id))
    .where(eq(config.memberships.entityId, entityId));
}

/**
 * Remove a member from the resolved entity: reject self-removal (DIVERGENT
 * code/message), fetch the target, reject when absent (NOT_FOUND), run the
 * optional owner guard (DIVERGENT), then delete. The shared control flow lives
 * here once; the per-level relational rules come from `config`.
 */
export async function removeMember<Permission extends string>(
  config: MemberCrudConfig<Permission>,
  resolveEntity: ResolveMemberEntity<Permission>,
  actorUserId: string,
  targetUserId: string,
) {
  const { id: entityId, role: actorRole } = await resolveEntity(config.permissions.remove);

  if (actorUserId === targetUserId) {
    throw new ServiceError(config.selfRemovalError.code, config.selfRemovalError.message);
  }

  const [target] = await db
    .select({ role: config.memberships.role })
    .from(config.memberships.table)
    .where(
      and(eq(config.memberships.entityId, entityId), eq(config.memberships.userId, targetUserId)),
    );

  if (!target) throw new ServiceError('NOT_FOUND', 'Member not found');

  config.ownerGuard?.(actorRole, target.role as TenancyRole);

  await db
    .delete(config.memberships.table)
    .where(
      and(eq(config.memberships.entityId, entityId), eq(config.memberships.userId, targetUserId)),
    );
}
