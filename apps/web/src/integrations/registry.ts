import { slackMetadata } from '@repo/integrations-core';
import { SlackSettingsComponent } from './slack/SettingsComponent';
import type { ComponentType } from 'react';
import type { SettingsComponentProps } from './slack/SettingsComponent';

export interface ClientRegistryEntry {
  metadata: typeof slackMetadata;
  SettingsComponent: ComponentType<SettingsComponentProps>;
}

export const clientRegistry: Record<string, ClientRegistryEntry> = {
  slack: {
    metadata: slackMetadata,
    SettingsComponent: SlackSettingsComponent,
  },
};

export function getRegistryEntry(type: string): ClientRegistryEntry | undefined {
  return clientRegistry[type];
}

export function getAllIntegrationTypes(): ClientRegistryEntry[] {
  return Object.values(clientRegistry);
}