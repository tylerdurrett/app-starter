import { z } from 'zod';

/**
 * Reusable API-contract primitives shared across tenancy resources.
 *
 * These base schemas are the single source of truth for the role/status enums
 * and the common `member` / `invite` record shapes. Resource families
 * (workspace here, project in follow-up work) build their concrete schemas by
 * extending these, so a rename or added field lands in exactly one place.
 *
 * Date-bearing fields are typed as `z.string()` because these schemas validate
 * JSON on the wire, where timestamps have already been serialized to ISO
 * strings.
 */

/** Full tenancy role ladder. Source of truth for `WorkspaceRole` in the apps. */
export const roleSchema = z.enum(['owner', 'manager', 'member']);
export type Role = z.infer<typeof roleSchema>;

/** Roles assignable via an invite. `owner` is reserved for the resource creator. */
export const inviteRoleSchema = z.enum(['manager', 'member']);
export type InviteRole = z.infer<typeof inviteRoleSchema>;

/** Lifecycle status of an invite. */
export const inviteStatusSchema = z.enum(['pending', 'accepted', 'revoked']);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

/** Fields common to every membership record. Concrete resources extend this. */
export const memberBaseSchema = z.object({
  userId: z.string(),
  role: roleSchema,
  createdAt: z.string(),
  name: z.string(),
  email: z.string(),
});
export type MemberBase = z.infer<typeof memberBaseSchema>;

/** Fields common to every invite record. Concrete resources extend this. */
export const inviteBaseSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: inviteRoleSchema,
  status: inviteStatusSchema,
  expiresAt: z.string(),
  createdAt: z.string(),
  invitedByName: z.string(),
});
export type InviteBase = z.infer<typeof inviteBaseSchema>;
