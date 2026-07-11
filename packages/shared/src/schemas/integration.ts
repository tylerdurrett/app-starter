import { z } from 'zod';

/**
 * Integration-resource API contract — the single source of truth for the shapes
 * exchanged between the server integration routes and the web client. Mirrors
 * the workspace family established in #70.
 *
 * Date-bearing fields are typed as `z.string()` because these schemas validate
 * JSON on the wire, where timestamps have already been serialized to ISO
 * strings (see the note in `base.ts`).
 */

/** Lifecycle status of an integration. */
export const integrationStatusSchema = z.enum(['pending', 'active', 'error']);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

/** Supported integration provider types. */
export const integrationTypeSchema = z.enum(['slack']);
export type IntegrationType = z.infer<typeof integrationTypeSchema>;

/** An integration record with credentials masked for client consumption. */
export const maskedIntegrationSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  type: integrationTypeSchema,
  name: z.string(),
  status: integrationStatusSchema,
  config: z.record(z.string(), z.unknown()),
  credentialsReadable: z.boolean(),
  lastTestedAt: z.string().nullable(),
  lastTestError: z.string().nullable(),
  createdByUserId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MaskedIntegration = z.infer<typeof maskedIntegrationSchema>;

/** Result of running an integration connectivity test. */
export const testIntegrationResultSchema = z.object({
  status: integrationStatusSchema,
  lastTestedAt: z.string(),
  info: z.record(z.string(), z.string()).optional(),
  error: z.string().optional(),
});
export type TestIntegrationResult = z.infer<typeof testIntegrationResultSchema>;
