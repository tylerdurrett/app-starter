import { describe, it, expect, beforeEach } from 'vitest';
import { PASSWORD_MIN_LENGTH } from '@repo/shared';
import { db, oauthClients } from '@repo/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { createTestServer, parseResponse, signUp } from './helpers.js';

interface AuthBody {
  user: { email: string; name: string };
  token: string;
}

interface ErrorBody {
  code?: string;
  message?: string;
}

describe('Auth endpoints', () => {
  let app: FastifyInstance;
  const testEmail = `test-${Date.now()}@example.com`;
  const testPassword = 'password123';
  const testName = 'Test User';

  beforeEach(async () => {
    app = await createTestServer();
    await app.ready();
  });

  it('should register a new user via sign-up endpoint', async () => {
    const { statusCode, body } = await signUp(app, testEmail, testName, testPassword);

    expect(statusCode).toBe(200);
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(testEmail);
    expect(body.user.name).toBe(testName);
    expect(body.token).toBeDefined();
  });

  it('should sign in with registered user', async () => {
    // First, register the user
    await signUp(app, `signin-${testEmail}`, testName, testPassword);

    // Then sign in
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: {
        'content-type': 'application/json',
      },
      payload: {
        email: `signin-${testEmail}`,
        password: testPassword,
      },
    });

    const { statusCode, body } = parseResponse<AuthBody>(response);
    expect(statusCode).toBe(200);
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(`signin-${testEmail}`);
    expect(body.token).toBeDefined();

    // Check for session cookie
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies).toContain('better-auth.session_token');
  });

  it('should get session with valid cookie', async () => {
    // Register and sign in to get a session
    const { cookie } = await signUp(app, `session-${testEmail}`, testName, testPassword);

    // Get session with the cookie
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: {
        cookie,
      },
    });

    const { statusCode, body } = parseResponse<{
      session: unknown;
      user: { email: string };
    }>(response);
    expect(statusCode).toBe(200);
    expect(body.session).toBeDefined();
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(`session-${testEmail}`);
  });

  it('should return unauthenticated for get-session without cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
    });

    const { statusCode, body } = parseResponse<null>(response);
    expect(statusCode).toBe(200);
    // Better Auth returns null when no session exists
    expect(body).toBeNull();
  });

  it('should return error for duplicate email registration', async () => {
    const duplicateEmail = `duplicate-${testEmail}`;

    // First registration should succeed
    const firstResponse = await signUp(app, duplicateEmail, testName, testPassword);

    expect(firstResponse.statusCode).toBe(200);

    // Second registration with same email should fail
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: {
        'content-type': 'application/json',
      },
      payload: {
        email: duplicateEmail,
        password: testPassword,
        name: testName,
      },
    });

    // Better Auth returns 422 for validation errors (duplicate email)
    const { statusCode, body } = parseResponse<ErrorBody>(secondResponse);
    expect(statusCode).toBe(422);
    expect(body.message).toBeDefined();
  });

  it('should reject sign-up with password shorter than PASSWORD_MIN_LENGTH', async () => {
    const shortPassword = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: {
        'content-type': 'application/json',
      },
      payload: {
        email: `short-pw-${testEmail}`,
        password: shortPassword,
        name: testName,
      },
    });

    const { statusCode, body } = parseResponse<ErrorBody>(response);
    expect(statusCode).toBe(400);
    expect(body.code).toBe('PASSWORD_TOO_SHORT');
  });

  it('should reject the intentionally weak local seed password for regular sign-up', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: {
        email: `weak-password-${testEmail}`,
        password: 'asdf',
        name: testName,
      },
    });

    const { statusCode, body } = parseResponse<ErrorBody>(response);
    expect(statusCode).toBe(400);
    expect(body.code).toBe('PASSWORD_TOO_SHORT');
  });

  it('should return error for invalid credentials on sign-in', async () => {
    // Register a user
    const invalidCredEmail = `invalid-${testEmail}`;
    await signUp(app, invalidCredEmail, testName, testPassword);

    // Try to sign in with wrong password
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: {
        'content-type': 'application/json',
      },
      payload: {
        email: invalidCredEmail,
        password: 'wrongpassword',
      },
    });

    // Better Auth returns 401 for authentication failures
    const { statusCode, body } = parseResponse<ErrorBody>(response);
    expect(statusCode).toBe(401);
    expect(body.message).toBeDefined();
  });

  it('rejects dynamic OAuth client registration', async () => {
    const clientName = `blocked-client-${Date.now()}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth2/register',
      headers: {
        'content-type': 'application/json',
      },
      payload: {
        client_name: clientName,
        redirect_uris: ['http://localhost:5200/oauth/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    });

    expect(response.statusCode).toBe(403);

    const rows = await db
      .select({ id: oauthClients.id })
      .from(oauthClients)
      .where(eq(oauthClients.name, clientName));
    expect(rows).toHaveLength(0);
  });
});
