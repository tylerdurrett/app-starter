import { z } from 'zod';
import {
  roleSchema,
  inviteStatusSchema,
  memberBaseSchema,
  inviteBaseSchema,
} from './base.js';

/**
 * Workspace-family API contract — the single source of truth for the shapes
 * exchanged between the server workspace routes and the web client. Built on
 * the reusable base primitives so the project resource can mirror this family.
 */

export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceWithRoleSchema = workspaceSchema.extend({
  role: roleSchema,
});
export type WorkspaceWithRole = z.infer<typeof workspaceWithRoleSchema>;

/** A workspace member — no fields beyond the shared membership base. */
export const workspaceMemberSchema = memberBaseSchema;
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

/** A workspace invite — no fields beyond the shared invite base. */
export const workspaceInviteSchema = inviteBaseSchema;
export type WorkspaceInvite = z.infer<typeof workspaceInviteSchema>;

/** Invite lifecycle status, re-exported under the workspace-family name. */
export type WorkspaceInviteStatus = z.infer<typeof inviteStatusSchema>;

export const workspaceInviteCreateResultSchema = z.object({
  invite: workspaceInviteSchema,
  inviteUrl: z.string(),
});
export type WorkspaceInviteCreateResult = z.infer<typeof workspaceInviteCreateResultSchema>;

/** Metadata for the unauthenticated invite-landing page, keyed by token. */
export const workspaceInviteMetadataSchema = z.object({
  inviteId: z.string(),
  email: z.string(),
  status: inviteStatusSchema,
  expiresAt: z.string(),
  workspaceName: z.string(),
  workspaceSlug: z.string(),
});
export type WorkspaceInviteMetadata = z.infer<typeof workspaceInviteMetadataSchema>;

/** Result of accepting an invite by token. */
export const workspaceInviteAcceptResultSchema = z.object({
  workspaceId: z.string(),
  workspaceSlug: z.string(),
  workspaceName: z.string(),
});
export type WorkspaceInviteAcceptResult = z.infer<typeof workspaceInviteAcceptResultSchema>;
