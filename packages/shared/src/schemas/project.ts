import { z } from 'zod';
import {
  roleSchema,
  inviteStatusSchema,
  memberBaseSchema,
  inviteBaseSchema,
} from './base.js';

/**
 * Project-family API contract — the single source of truth for the shapes
 * exchanged between the server project routes and the web client. Mirrors the
 * workspace family and builds on the reusable base primitives, so a rename or
 * added member/invite field lands in exactly one place.
 *
 * Project responses carry parent-workspace context (`workspaceSlug` /
 * `workspaceName`) so the client can render the owning workspace even for
 * project-only access.
 */

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  workspaceId: z.string(),
  workspaceSlug: z.string(),
  workspaceName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectWithRoleSchema = projectSchema.extend({
  role: roleSchema,
});
export type ProjectWithRole = z.infer<typeof projectWithRoleSchema>;

/**
 * Returned by GET /api/workspaces/:workspaceSlug/projects/:projectSlug — the
 * with-role shape enriched with workspace context. Type-equal to
 * {@link ProjectWithRole}; the alias documents the workspace-aware call site.
 */
export type ProjectWithWorkspace = ProjectWithRole;

/** A project member — no fields beyond the shared membership base. */
export const projectMemberSchema = memberBaseSchema;
export type ProjectMember = z.infer<typeof projectMemberSchema>;

/** A project invite — no fields beyond the shared invite base. */
export const projectInviteSchema = inviteBaseSchema;
export type ProjectInvite = z.infer<typeof projectInviteSchema>;

/** Invite lifecycle status, re-exported under the project-family name. */
export type ProjectInviteStatus = z.infer<typeof inviteStatusSchema>;

export const projectInviteCreateResultSchema = z.object({
  invite: projectInviteSchema,
  inviteUrl: z.string(),
});
export type ProjectInviteCreateResult = z.infer<typeof projectInviteCreateResultSchema>;

/** Metadata for the unauthenticated invite-landing page, keyed by token. */
export const projectInviteMetadataSchema = z.object({
  inviteId: z.string(),
  email: z.string(),
  status: inviteStatusSchema,
  expiresAt: z.string(),
  projectName: z.string(),
  projectSlug: z.string(),
  workspaceName: z.string(),
  workspaceSlug: z.string(),
});
export type ProjectInviteMetadata = z.infer<typeof projectInviteMetadataSchema>;

/** Result of accepting an invite by token. */
export const projectInviteAcceptResultSchema = z.object({
  projectId: z.string(),
  projectSlug: z.string(),
});
export type ProjectInviteAcceptResult = z.infer<typeof projectInviteAcceptResultSchema>;
