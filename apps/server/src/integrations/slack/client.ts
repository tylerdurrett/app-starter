// Minimal Slack Web API client used by the integration test flow.
// Validates a bot token against auth.test and returns workspace metadata.

export type SlackTestResult =
  | { ok: true; team: string; teamId: string; user: string; userId: string; botId: string; url: string }
  | { ok: false; error: string };  // error = slack error code OR "network_error"

export async function slackAuthTest(botToken: string): Promise<SlackTestResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const response = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      // Non-2xx status
      return { ok: false, error: 'network_error' };
    }

    const data = await response.json();

    // Check if Slack returned an error
    if (!data.ok) {
      // Slack API returned an error (e.g., invalid_auth, not_authed, etc.)
      return { ok: false, error: data.error || 'network_error' };
    }

    // Successful response - extract the fields we need
    // Note: bot_id is only present when using a bot token
    return {
      ok: true,
      team: data.team || '',
      teamId: data.team_id || '',
      user: data.user || '',
      userId: data.user_id || '',
      botId: data.bot_id || '',
      url: data.url || '',
    };
  } catch {
    // Network error, JSON parse error, or other unexpected error
    return { ok: false, error: 'network_error' };
  } finally {
    clearTimeout(timeoutId);
  }
}
