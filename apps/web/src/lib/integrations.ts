import { apiFetch } from './api';

export type IntegrationStatus = 'pending' | 'active' | 'error';
export type IntegrationType = 'slack';

export interface MaskedIntegration {
  id: string;
  workspaceId: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  credentialsReadable: boolean;
  lastTestedAt: string | null;
  lastTestError: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateIntegrationInput {
  type: IntegrationType;
  name: string;
  config: Record<string, unknown>;
}

export interface UpdateIntegrationInput {
  name?: string;
  config?: Record<string, unknown>;
}

export interface TestIntegrationResult {
  status: IntegrationStatus;
  lastTestedAt: string;
  info?: Record<string, string>;
  error?: string;
}

export async function listIntegrations(workspaceSlug: string): Promise<MaskedIntegration[]> {
  return apiFetch<MaskedIntegration[]>(`/api/workspaces/${workspaceSlug}/integrations`);
}

export async function getIntegration(
  workspaceSlug: string,
  integrationId: string,
): Promise<MaskedIntegration> {
  return apiFetch<MaskedIntegration>(`/api/workspaces/${workspaceSlug}/integrations/${integrationId}`);
}

export async function createIntegration(
  workspaceSlug: string,
  data: CreateIntegrationInput,
): Promise<MaskedIntegration> {
  return apiFetch<MaskedIntegration>(`/api/workspaces/${workspaceSlug}/integrations`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateIntegration(
  workspaceSlug: string,
  integrationId: string,
  data: UpdateIntegrationInput,
): Promise<MaskedIntegration> {
  return apiFetch<MaskedIntegration>(`/api/workspaces/${workspaceSlug}/integrations/${integrationId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
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
  return apiFetch<TestIntegrationResult>(`/api/workspaces/${workspaceSlug}/integrations/${integrationId}/test`, {
    method: 'POST',
  });
}