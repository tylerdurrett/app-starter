import { db, integrations, type IntegrationsInsertType, type IntegrationsSelectType } from '@repo/db';
import { eq, and, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { resolveWorkspaceAndRole } from '../workspaces/service.js';
import { getRegistryEntry } from './registry.js';
import { encryptConfigFields, decryptConfigFields, isEncrypted } from './crypto.js';
import { maskSecret } from './mask.js';
import type { IntegrationStatus } from '@repo/integrations-core';

// Settings validation for the Slack reference connector.
const slackSettingsSchema = z.object({
  name: z.string().min(1),
  botToken: z.string().startsWith('xoxb-'),
  signingSecret: z.string().min(16),
});

export class ServiceError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'BAD_REQUEST' | 'VALIDATION',
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export interface MaskedIntegration extends Omit<IntegrationsSelectType, 'config'> {
  config: Record<string, unknown>;
  credentialsReadable: boolean;
}

function maskIntegration(integration: IntegrationsSelectType, credentialFields: readonly string[]): MaskedIntegration {
  const rawConfig = integration.config as Record<string, unknown>;

  let maskedConfig: Record<string, unknown>;
  let credentialsReadable: boolean;

  try {
    const decryptedConfig = decryptConfigFields(rawConfig, credentialFields);
    maskedConfig = { ...decryptedConfig };
    for (const field of credentialFields) {
      if (typeof maskedConfig[field] === 'string') {
        maskedConfig[field] = maskSecret(maskedConfig[field] as string);
      }
    }
    credentialsReadable = true;
  } catch {
    // Key rotated/lost: keep the row in the response minus its ciphertext
    // so the UI can offer delete + recreate instead of 500ing the list.
    maskedConfig = {};
    for (const [k, v] of Object.entries(rawConfig)) {
      if (!isEncrypted(v)) {
        maskedConfig[k] = v;
      }
    }
    credentialsReadable = false;
  }

  return {
    ...integration,
    config: maskedConfig,
    credentialsReadable,
  };
}

export async function listIntegrations(
  workspaceSlug: string,
  actorUserId: string
): Promise<MaskedIntegration[]> {
  const { workspace } = await resolveWorkspaceAndRole(
    workspaceSlug,
    actorUserId,
    'integrations:read'
  );

  const rows = await db
    .select()
    .from(integrations)
    .where(eq(integrations.workspaceId, workspace.id))
    .orderBy(asc(integrations.createdAt));

  return rows.map(row => {
    const entry = getRegistryEntry(row.type);
    return maskIntegration(row, entry.metadata.credentialFields);
  });
}

export async function getIntegration(
  workspaceSlug: string,
  integrationId: string,
  actorUserId: string
): Promise<MaskedIntegration> {
  const { workspace } = await resolveWorkspaceAndRole(
    workspaceSlug,
    actorUserId,
    'integrations:read'
  );

  const [row] = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.id, integrationId),
        eq(integrations.workspaceId, workspace.id)
      )
    );

  if (!row) {
    throw new ServiceError('NOT_FOUND', 'Integration not found');
  }

  const entry = getRegistryEntry(row.type);
  return maskIntegration(row, entry.metadata.credentialFields);
}

export async function createIntegration(
  workspaceSlug: string,
  actorUserId: string,
  args: {
    type: string;
    name: string;
    config: Record<string, unknown>;
  }
): Promise<MaskedIntegration> {
  const { workspace } = await resolveWorkspaceAndRole(
    workspaceSlug,
    actorUserId,
    'integrations:manage'
  );

  // Validate type against registry
  const entry = getRegistryEntry(args.type);

  // Validate config against schema if available
  if (args.type === 'slack') {
    const parseResult = slackSettingsSchema.safeParse({ ...args.config, name: args.name });
    if (!parseResult.success) {
      throw new ServiceError('VALIDATION', `Invalid configuration: ${parseResult.error.message}`);
    }
  }

  // Encrypt credential fields
  const encryptedConfig = encryptConfigFields(args.config, entry.metadata.credentialFields);

  const id = randomUUID();
  const [created] = await db
    .insert(integrations)
    .values({
      id,
      workspaceId: workspace.id,
      type: args.type,
      name: args.name,
      config: encryptedConfig,
      status: 'pending',
      createdByUserId: actorUserId,
    })
    .returning();

  if (!created) {
    throw new Error('createIntegration: insert returned no rows');
  }

  return maskIntegration(created, entry.metadata.credentialFields);
}

export async function updateIntegration(
  workspaceSlug: string,
  integrationId: string,
  actorUserId: string,
  args: {
    name?: string;
    config?: Record<string, unknown>;
  }
): Promise<MaskedIntegration> {
  const { workspace } = await resolveWorkspaceAndRole(
    workspaceSlug,
    actorUserId,
    'integrations:manage'
  );

  // Load existing integration
  const [existing] = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.id, integrationId),
        eq(integrations.workspaceId, workspace.id)
      )
    );

  if (!existing) {
    throw new ServiceError('NOT_FOUND', 'Integration not found');
  }

  const entry = getRegistryEntry(existing.type);

  let updatedConfig = existing.config as Record<string, unknown>;
  let configChanged = false;

  if (args.config) {
    // Decrypt existing config
    const decryptedExisting = decryptConfigFields(
      existing.config as Record<string, unknown>,
      entry.metadata.credentialFields
    );

    // Merge with new config (new values override)
    const mergedConfig = { ...decryptedExisting, ...args.config };

    // Validate merged config if applicable
    if (existing.type === 'slack') {
      const parseResult = slackSettingsSchema.safeParse({
        ...mergedConfig,
        name: args.name || existing.name
      });
      if (!parseResult.success) {
        throw new ServiceError('VALIDATION', `Invalid configuration: ${parseResult.error.message}`);
      }
    }

    // Re-encrypt the merged config
    updatedConfig = encryptConfigFields(mergedConfig, entry.metadata.credentialFields);
    configChanged = true;
  }

  // Update the integration
  const updateData: Partial<IntegrationsInsertType> = {
    updatedAt: new Date(),
  };

  if (args.name !== undefined) {
    updateData.name = args.name;
  }

  if (configChanged) {
    updateData.config = updatedConfig;
    updateData.status = 'pending'; // Reset status when config changes
  }

  const [updated] = await db
    .update(integrations)
    .set(updateData)
    .where(eq(integrations.id, integrationId))
    .returning();

  if (!updated) {
    throw new Error('updateIntegration: update returned no rows');
  }

  // Auto-test if config changed
  if (configChanged) {
    await testIntegration(workspaceSlug, integrationId, actorUserId);
    // Reload to get updated status
    const [retested] = await db
      .select()
      .from(integrations)
      .where(eq(integrations.id, integrationId));

    if (retested) {
      return maskIntegration(retested, entry.metadata.credentialFields);
    }
  }

  return maskIntegration(updated, entry.metadata.credentialFields);
}

export async function deleteIntegration(
  workspaceSlug: string,
  integrationId: string,
  actorUserId: string
): Promise<void> {
  const { workspace } = await resolveWorkspaceAndRole(
    workspaceSlug,
    actorUserId,
    'integrations:manage'
  );

  const result = await db
    .delete(integrations)
    .where(
      and(
        eq(integrations.id, integrationId),
        eq(integrations.workspaceId, workspace.id)
      )
    );

  if (!result.count) {
    throw new ServiceError('NOT_FOUND', 'Integration not found');
  }
}

export async function testIntegration(
  workspaceSlug: string,
  integrationId: string,
  actorUserId: string
): Promise<{
  status: IntegrationStatus;
  lastTestedAt: Date;
  info?: Record<string, string>;
  error?: string;
}> {
  const { workspace } = await resolveWorkspaceAndRole(
    workspaceSlug,
    actorUserId,
    'integrations:manage'
  );

  // Load the integration
  const [integration] = await db
    .select()
    .from(integrations)
    .where(
      and(
        eq(integrations.id, integrationId),
        eq(integrations.workspaceId, workspace.id)
      )
    );

  if (!integration) {
    throw new ServiceError('NOT_FOUND', 'Integration not found');
  }

  const entry = getRegistryEntry(integration.type);

  // Decrypt credentials
  const decryptedConfig = decryptConfigFields(
    integration.config as Record<string, unknown>,
    entry.metadata.credentialFields
  );

  // Run the test
  const testResult = await entry.test(decryptedConfig);

  const now = new Date();
  let status: IntegrationStatus;
  let lastTestError: string | null = null;
  let info: Record<string, string> | undefined;

  const updatePayload: Partial<IntegrationsInsertType> = {
    lastTestedAt: now,
    updatedAt: now,
  };

  if (testResult.ok) {
    status = 'active';
    info = testResult.info;

    // slackMeta is plaintext (not in credentialFields) so it passes through
    // unmasked, letting the UI show which Slack workspace is connected.
    const updatedConfig = {
      ...decryptedConfig,
      slackMeta: {
        teamUrl: testResult.info.url || '',
        teamId: testResult.info.teamId || '',
        team: testResult.info.team || '',
      },
    };
    updatePayload.config = encryptConfigFields(updatedConfig, entry.metadata.credentialFields);
  } else {
    status = 'error';
    lastTestError = testResult.error;
  }

  updatePayload.status = status;
  updatePayload.lastTestError = lastTestError;

  // Persist the test results
  await db
    .update(integrations)
    .set(updatePayload)
    .where(eq(integrations.id, integrationId));

  return {
    status,
    lastTestedAt: now,
    info,
    error: lastTestError || undefined,
  };
}