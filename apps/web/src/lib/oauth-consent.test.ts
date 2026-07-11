import { afterEach, describe, expect, it, vi } from 'vitest';

// The OAuth consent lib talks to Better Auth's OAuth provider plugin through
// authClient.$fetch (returns { data, error }). Mock that boundary so the two
// data operations can be unit-tested in the node env without rendering the
// route or hitting a real server.
const { $fetch } = vi.hoisted(() => ({ $fetch: vi.fn() }));
vi.mock('./auth-client', () => ({
  authClient: { $fetch },
}));

import { fetchOAuthClient, submitConsent } from './oauth-consent';

afterEach(() => {
  $fetch.mockReset();
});

describe('fetchOAuthClient', () => {
  it('unwraps and returns the client info on success', async () => {
    const clientInfo = {
      client_id: 'client-123',
      client_name: 'Acme App',
      policy_uri: 'https://acme.example/policy',
    };
    $fetch.mockResolvedValue({ data: clientInfo, error: null });

    await expect(fetchOAuthClient('client-123')).resolves.toEqual(clientInfo);
    expect($fetch).toHaveBeenCalledWith('/oauth2/public-client?client_id=client-123');
  });

  it('url-encodes the client id in the request path', async () => {
    $fetch.mockResolvedValue({ data: null, error: null });
    await fetchOAuthClient('a b/c');
    expect($fetch).toHaveBeenCalledWith('/oauth2/public-client?client_id=a%20b%2Fc');
  });

  it('resolves to null (non-fatal) when the fetch returns an error', async () => {
    $fetch.mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(fetchOAuthClient('client-123')).resolves.toBeNull();
  });

  it('resolves to null (non-fatal) when the fetch rejects', async () => {
    $fetch.mockRejectedValue(new Error('network down'));
    await expect(fetchOAuthClient('client-123')).resolves.toBeNull();
  });
});

describe('submitConsent', () => {
  it('returns the callback redirect url on success', async () => {
    $fetch.mockResolvedValue({ data: { url: 'https://client.example/callback?code=abc' }, error: null });

    await expect(submitConsent(true)).resolves.toEqual({
      url: 'https://client.example/callback?code=abc',
    });
    expect($fetch).toHaveBeenCalledWith('/oauth2/consent', {
      method: 'POST',
      body: { accept: true },
    });
  });

  it('forwards a deny decision in the request body', async () => {
    $fetch.mockResolvedValue({ data: { url: 'https://client.example/denied' }, error: null });
    await submitConsent(false);
    expect($fetch).toHaveBeenCalledWith('/oauth2/consent', {
      method: 'POST',
      body: { accept: false },
    });
  });

  it('throws with the server message when the fetch returns an error', async () => {
    $fetch.mockResolvedValue({ data: null, error: { message: 'consent denied by policy' } });
    await expect(submitConsent(true)).rejects.toThrow('consent denied by policy');
  });

  it('throws when the successful response is missing a url', async () => {
    $fetch.mockResolvedValue({ data: {}, error: null });
    await expect(submitConsent(true)).rejects.toThrow('Unexpected response from the server.');
  });
});
