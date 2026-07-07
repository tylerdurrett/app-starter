import type { IntegrationRegistryMetadata } from '../types.js';

export const slackMetadata: IntegrationRegistryMetadata = {
  type: 'slack',
  displayName: 'Slack',
  icon: '💬',
  description: 'Connect a Slack workspace with a bot token.',
  credentialFields: ['botToken', 'signingSecret'],
};
