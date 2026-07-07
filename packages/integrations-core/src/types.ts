export type IntegrationStatus = 'pending' | 'active' | 'error';

export type IntegrationType = 'slack';

export interface IntegrationRegistryMetadata {
  type: IntegrationType;
  displayName: string;
  icon: string;
  description: string;
  credentialFields: readonly string[];
}
