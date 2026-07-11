import { describe, it, expect } from 'vitest';
import { resolveEntityAndRole, type ResolvedRole } from '../src/tenancy/index.js';
import type { TenancyRole } from '../src/tenancy/index.js';

// In-memory fakes: no DB. Exercises the invariant skeleton in isolation.

type Entity = { id: string };
type Permission = 'read' | 'write';

const MATRIX: Record<TenancyRole, Set<Permission>> = {
  owner: new Set<Permission>(['read', 'write']),
  manager: new Set<Permission>(['read', 'write']),
  member: new Set<Permission>(['read']),
};

const can = (role: TenancyRole, permission: Permission): boolean => MATRIX[role].has(permission);

const found = (): Promise<Entity | undefined> => Promise.resolve({ id: 'e1' });
const missing = (): Promise<Entity | undefined> => Promise.resolve(undefined);

const resolvesTo =
  (resolved: ResolvedRole<TenancyRole> | undefined) =>
  (): Promise<ResolvedRole<TenancyRole> | undefined> =>
    Promise.resolve(resolved);

describe('resolveEntityAndRole', () => {
  it('throws NOT_FOUND when the entity is absent (never runs resolvers)', async () => {
    await expect(
      resolveEntityAndRole<Entity, TenancyRole, Permission>({
        lookup: missing,
        roleResolvers: [resolvesTo({ role: 'owner' })],
        can,
        requiredPermission: undefined,
        notFoundMessage: 'nope',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND when the entity exists but no resolver matches (404-never-403)', async () => {
    await expect(
      resolveEntityAndRole<Entity, TenancyRole, Permission>({
        lookup: found,
        roleResolvers: [resolvesTo(undefined), resolvesTo(undefined)],
        can,
        requiredPermission: undefined,
        notFoundMessage: 'nope',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns the first matching resolver (precedence — direct beats override)', async () => {
    const result = await resolveEntityAndRole<Entity, TenancyRole, Permission>({
      lookup: found,
      roleResolvers: [
        resolvesTo({ role: 'member' }), // direct membership wins
        resolvesTo({ role: 'owner', viaOverride: true }), // override never reached
      ],
      can,
      requiredPermission: undefined,
      notFoundMessage: 'nope',
    });
    expect(result.role).toBe('member');
    expect(result.viaOverride).toBeFalsy();
    expect(result.entity.id).toBe('e1');
  });

  it('carries the override flag from the matching resolver', async () => {
    const result = await resolveEntityAndRole<Entity, TenancyRole, Permission>({
      lookup: found,
      roleResolvers: [resolvesTo(undefined), resolvesTo({ role: 'owner', viaOverride: true })],
      can,
      requiredPermission: undefined,
      notFoundMessage: 'nope',
    });
    expect(result.role).toBe('owner');
    expect(result.viaOverride).toBe(true);
  });

  it('throws FORBIDDEN when the resolved role lacks the required permission', async () => {
    await expect(
      resolveEntityAndRole<Entity, TenancyRole, Permission>({
        lookup: found,
        roleResolvers: [resolvesTo({ role: 'member' })],
        can,
        requiredPermission: 'write',
        notFoundMessage: 'nope',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('passes the permission check when the resolved role has the permission', async () => {
    const result = await resolveEntityAndRole<Entity, TenancyRole, Permission>({
      lookup: found,
      roleResolvers: [resolvesTo({ role: 'member' })],
      can,
      requiredPermission: 'read',
      notFoundMessage: 'nope',
    });
    expect(result.role).toBe('member');
  });
});
