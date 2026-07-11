import { authClient } from './auth-client';

// OAuth client metadata returned by Better Auth's OAuth provider plugin. This
// page talks to the plugin endpoints via authClient.$fetch (returns
// { data, error }), NOT the app's own apiFetch — so there is no @repo/shared
// zod contract for this shape and the interface stays local.
export interface ClientInfo {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  tos_uri?: string;
  policy_uri?: string;
}

/**
 * Fetch public OAuth client metadata for the consent screen.
 *
 * Non-gating and non-fatal: the consent page renders correctly without it
 * (falling back to the client_id as the display name), so on any error we warn
 * and resolve to `null` rather than throwing — the caller's useQuery stays in a
 * success state and the UI degrades gracefully.
 */
export async function fetchOAuthClient(clientId: string): Promise<ClientInfo | null> {
  try {
    const { data, error } = await authClient.$fetch(
      `/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`,
    );
    if (error) {
      console.warn('Failed to fetch client info:', error);
      return null;
    }
    return (data as ClientInfo | undefined) ?? null;
  } catch {
    console.warn('Failed to fetch client info');
    return null;
  }
}

/**
 * Submit the user's consent decision. Unlike the client-info read this is a
 * gating write: on error it throws so the caller's useMutation surfaces the
 * failure, and on success it returns the callback `url` the browser must
 * redirect to (cross-origin, back to the OAuth client).
 */
export async function submitConsent(accept: boolean): Promise<{ url: string }> {
  const { data, error } = await authClient.$fetch('/oauth2/consent', {
    method: 'POST',
    body: { accept },
  });

  if (error) {
    throw new Error(
      (error as { message?: string }).message ||
        'An error occurred while processing your consent.',
    );
  }

  const url = (data as { url?: string } | null)?.url;
  if (!url) {
    throw new Error('Unexpected response from the server.');
  }

  return { url };
}
