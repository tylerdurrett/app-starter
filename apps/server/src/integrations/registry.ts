import { slackMetadata } from '@repo/integrations-core';
import { slackAuthTest } from './slack/client.js';

export interface ServerRegistryEntry {
  metadata: typeof slackMetadata;  // replace with union as more types land
  test: (decryptedConfig: Record<string, unknown>) => Promise<{ ok: true; info: Record<string, string> } | { ok: false; error: string }>;
}

export const serverRegistry: Record<string, ServerRegistryEntry> = {
  slack: {
    metadata: slackMetadata,
    test: async (cfg) => {
      // Validate botToken exists and is a string
      if (!cfg.botToken || typeof cfg.botToken !== 'string') {
        return { ok: false, error: 'missing_bot_token' };
      }

      const result = await slackAuthTest(cfg.botToken);
      if (result.ok) {
        return {
          ok: true,
          info: {
            team: result.team,
            teamId: result.teamId,
            user: result.user,
            userId: result.userId,
            botId: result.botId,
            url: result.url,
          }
        };
      }
      return { ok: false, error: result.error };
    },
  },
};

export function getRegistryEntry(type: string): ServerRegistryEntry {
  const entry = serverRegistry[type];
  if (!entry) throw new Error(`Unknown integration type: ${type}`);
  return entry;
}
