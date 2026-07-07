import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { slackAuthTest } from '../src/integrations/slack/client.js';

describe('Slack Handler', () => {
  beforeEach(() => {
    // Mock global fetch
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return success when Slack returns ok: true', async () => {
    const mockResponse = {
      ok: true,
      team: 'Test Workspace',
      team_id: 'T1234567',
      user: 'testbot',
      user_id: 'U1234567',
      bot_id: 'B1234567',
      url: 'https://test.slack.com/',
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await slackAuthTest('xoxb-test-token');

    expect(result).toEqual({
      ok: true,
      team: 'Test Workspace',
      teamId: 'T1234567',
      user: 'testbot',
      userId: 'U1234567',
      botId: 'B1234567',
      url: 'https://test.slack.com/',
    });

    expect(fetch).toHaveBeenCalledWith('https://slack.com/api/auth.test',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('should return error when Slack returns invalid_auth', async () => {
    const mockResponse = {
      ok: false,
      error: 'invalid_auth',
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await slackAuthTest('xoxb-invalid-token');

    expect(result).toEqual({
      ok: false,
      error: 'invalid_auth',
    });
  });

  it('should return network_error when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network failure'));

    const result = await slackAuthTest('xoxb-test-token');

    expect(result).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('should return network_error for non-2xx status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    const result = await slackAuthTest('xoxb-test-token');

    expect(result).toEqual({
      ok: false,
      error: 'network_error',
    });
  });

  it('should handle missing fields gracefully', async () => {
    const mockResponse = {
      ok: true,
      // Minimal response with some fields missing
      team: 'Test Workspace',
      team_id: 'T1234567',
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await slackAuthTest('xoxb-test-token');

    expect(result).toEqual({
      ok: true,
      team: 'Test Workspace',
      teamId: 'T1234567',
      user: '',
      userId: '',
      botId: '',
      url: '',
    });
  });

  it('should handle Slack error without error field', async () => {
    const mockResponse = {
      ok: false,
      // No error field
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await slackAuthTest('xoxb-test-token');

    expect(result).toEqual({
      ok: false,
      error: 'network_error',
    });
  });
});

