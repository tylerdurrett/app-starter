import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type ApiModule = typeof import('./api');
let api: ApiModule;

beforeAll(async () => {
  vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
  api = await import('./api');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('ApiError.parsedMessage', () => {
  it('reads the API error string returned by the server', () => {
    const error = new api.ApiError(409, JSON.stringify({ error: 'Invite already exists' }));

    expect(error.parsedMessage).toBe('Invite already exists');
  });

  it('reads a nested structured error message', () => {
    const error = new api.ApiError(
      400,
      JSON.stringify({ error: { code: 'INVALID', message: 'Name is invalid' } }),
    );

    expect(error.parsedMessage).toBe('Name is invalid');
  });

  it.each([
    ['unparseable text', 'not json'],
    ['a missing error field', JSON.stringify({ message: 'Wrong shape' })],
    ['a non-message error value', JSON.stringify({ error: { code: 'INVALID' } })],
  ])('returns null for %s', (_case, body) => {
    expect(new api.ApiError(500, body).parsedMessage).toBeNull();
  });
});

describe('apiErrorMessage', () => {
  it('presents a structured API message', () => {
    const error = new api.ApiError(400, JSON.stringify({ error: 'Confirmation mismatch' }));

    expect(api.apiErrorMessage(error, 'Delete failed')).toBe('Confirmation mismatch');
  });

  it('uses fallback copy for malformed API errors and unrelated errors', () => {
    expect(api.apiErrorMessage(new api.ApiError(500, '<html>error</html>'), 'Try again')).toBe(
      'Try again',
    );
    expect(api.apiErrorMessage(new Error('Internal detail'), 'Try again')).toBe('Try again');
  });
});
