import { ServiceError } from './errors.js';
import type { TenancyRole } from './roles.js';

/**
 * A role resolved for the actor, plus whether it was reached through an
 * override (non-direct) path rather than a direct membership record.
 */
export interface ResolvedRole<Role extends TenancyRole> {
  role: Role;
  viaOverride?: boolean;
}

/**
 * The invariant role-resolution skeleton shared by every tenancy level.
 *
 * It encodes three rules exactly once (see ADR-0005):
 *
 * 1. Look up the entity; if it is absent, throw `NOT_FOUND`.
 * 2. Resolve the actor's role by trying an ordered list of role resolvers —
 *    the first that returns a role wins (this is how "direct membership takes
 *    precedence over override" is expressed). If none match, throw `NOT_FOUND`.
 *    A missing entity and a non-member are therefore indistinguishable: the
 *    404-never-403 guarantee.
 * 3. If a `requiredPermission` is supplied and the resolved role lacks it,
 *    throw `FORBIDDEN` via the level-supplied permission predicate.
 *
 * Parameterizing by level keeps per-level differences (composite lookups,
 * workspace override) in the resolvers while the skeleton stays identical.
 */
export async function resolveEntityAndRole<
  Entity,
  Role extends TenancyRole,
  Permission extends string,
>(params: {
  /** Look up the entity; return undefined when it does not exist. */
  lookup: () => Promise<Entity | undefined>;
  /** Ordered role resolvers; the first to return a role wins. */
  roleResolvers: Array<(entity: Entity) => Promise<ResolvedRole<Role> | undefined>>;
  /** Level-bound permission predicate (e.g. WORKSPACE/PROJECT `can`). */
  can: (role: Role, permission: Permission) => boolean;
  /** Permission to enforce, or undefined to skip the check. */
  requiredPermission: Permission | undefined;
  /** Message used for both not-found cases (missing entity, no access). */
  notFoundMessage: string;
}): Promise<{ entity: Entity; role: Role; viaOverride?: boolean }> {
  const entity = await params.lookup();
  if (!entity) throw new ServiceError('NOT_FOUND', params.notFoundMessage);

  let resolved: ResolvedRole<Role> | undefined;
  for (const resolver of params.roleResolvers) {
    resolved = await resolver(entity);
    if (resolved) break;
  }

  if (!resolved) throw new ServiceError('NOT_FOUND', params.notFoundMessage);

  if (params.requiredPermission && !params.can(resolved.role, params.requiredPermission)) {
    throw new ServiceError('FORBIDDEN', `Missing permission: ${params.requiredPermission}`);
  }

  return { entity, role: resolved.role, viaOverride: resolved.viaOverride };
}
