import { apiFetch, apiFetchParsed } from './api';
import {
  maskedIntegrationSchema,
  testIntegrationResultSchema,
  type IntegrationStatus,
  type IntegrationType,
  type MaskedIntegration,
  type TestIntegrationResult,
} from '@repo/shared';

// Response types are inferred from the shared API-contract schemas
// (@repo/shared) — the single source of truth for these shapes.
export type {
  IntegrationStatus,
  IntegrationType,
  MaskedIntegration,
  TestIntegrationResult,
};

// Request-input types are hand-declared here — request-input validation is out
// of scope for the shared contract.
export interface CreateIntegrationInput {
  type: IntegrationType;
  name: string;
  config: Record<string, unknown>;
}

export interface UpdateIntegrationInput {
  name?: string;
  config?: Record<string, unknown>;
}

export async function listIntegrations(workspaceSlug: string): Promise<MaskedIntegration[]> {
  return apiFetchParsed(
    `/api/workspaces/${workspaceSlug}/integrations`,
    maskedIntegrationSchema.array(),
  );
}

export async function getIntegration(
  workspaceSlug: string,
  integrationId: string,
): Promise<MaskedIntegration> {
  return apiFetchParsed(
    `/api/workspaces/${workspaceSlug}/integrations/${integrationId}`,
    maskedIntegrationSchema,
  );
}

export async function createIntegration(
  workspaceSlug: string,
  data: CreateIntegrationInput,
): Promise<MaskedIntegration> {
  return apiFetchParsed(`/api/workspaces/${workspaceSlug}/integrations`, maskedIntegrationSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateIntegration(
  workspaceSlug: string,
  integrationId: string,
  data: UpdateIntegrationInput,
): Promise<MaskedIntegration> {
  return apiFetchParsed(
    `/api/workspaces/${workspaceSlug}/integrations/${integrationId}`,
    maskedIntegrationSchema,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
  );
}

export async function deleteIntegration(
  workspaceSlug: string,
  integrationId: string,
): Promise<void> {
  await apiFetch<void>(`/api/workspaces/${workspaceSlug}/integrations/${integrationId}`, {
    method: 'DELETE',
  });
}

export async function testIntegration(
  workspaceSlug: string,
  integrationId: string,
): Promise<TestIntegrationResult> {
  return apiFetchParsed(
    `/api/workspaces/${workspaceSlug}/integrations/${integrationId}/test`,
    testIntegrationResultSchema,
    {
      method: 'POST',
    },
  );
}
