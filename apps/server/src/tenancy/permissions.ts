import type { TenancyRole } from './roles.js';

/** A permission matrix mapping each tenancy role to the permissions it grants. */
export type PermissionMatrix<P extends string> = Record<TenancyRole, Set<P>>;

/** Check whether a role has a given permission in the supplied matrix. */
export function can<P extends string>(
  matrix: PermissionMatrix<P>,
  role: TenancyRole,
  permission: P,
): boolean {
  return matrix[role].has(permission);
}
