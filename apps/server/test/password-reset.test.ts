import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createTestServer, parseResponse, signUp } from './helpers.js';

// Spy on sendEmail so we can assert on the reset link without touching Resend.
const sendEmailMock = vi.fn(async () => {});
vi.mock('../src/email/send.js', () => ({ sendEmail: sendEmailMock }));

// The server imports auth.ts which imports email/send.js — so the mock above must come first.

const REDIRECT_TO = 'http://localhost:5200/reset-password';

function lastSentEmail() {
  const last = sendEmailMock.mock.calls.at(-1)?.[0] as
    | { to: string; subject: string; html: string; text: string }
    | undefined;
  if (!last) throw new Error('No email was sent');
  return last;
}

function tokenFromUrl(url: string): string {
  // Better Auth URL shape: `${baseURL}/reset-password/${token}?callbackURL=...`
  const match = url.match(/\/reset-password\/([^?/]+)/);
  if (!match) throw new Error(`Could not extract token from URL: ${url}`);
  return decodeURIComponent(match[1]!);
}

function tokenFromLastEmail() {
  const { text } = lastSentEmail();
  const urlMatch = text.match(/https?:\/\/\S+/);
  if (!urlMatch) throw new Error('No URL in email body');
  return tokenFromUrl(urlMatch[0]);
}

describe('Password reset endpoints', () => {
  let app: FastifyInstance;
  const stamp = Date.now();
  let email: string;
  let testNumber = 0;
  const originalPassword = 'originalPw1';
  const newPassword = 'brandNewPw2';
  const name = 'Reset Tester';

  beforeEach(async () => {
    sendEmailMock.mockClear();
    email = `reset-${stamp}-${testNumber}@example.com`;
    testNumber += 1;
    app = await createTestServer();
    await app.ready();
    await signUp(app, email, name, originalPassword);
  });

  it('sends a reset email for a registered user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { 'content-type': 'application/json' },
      payload: { email, redirectTo: REDIRECT_TO },
    });

    const { statusCode } = parseResponse<unknown>(response);
    expect(statusCode).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const sent = lastSentEmail();
    expect(sent.to).toBe(email);
    expect(sent.subject).toBe('Reset your password');
    expect(sent.html).toContain('/reset-password/');
    expect(sent.text).toContain('/reset-password/');
    expect(sent.html).toContain('App Starter account');
    expect(sent.text).toContain('App Starter account');
  });

  it('does not send to an unregistered email and does not reveal existence', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { 'content-type': 'application/json' },
      payload: { email: `nobody-${stamp}@example.com`, redirectTo: REDIRECT_TO },
    });

    // Better Auth returns 200 whether the email exists or not (no enumeration).
    const { statusCode } = parseResponse<unknown>(response);
    expect(statusCode).toBe(200);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('resets the password when given a valid token', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { 'content-type': 'application/json' },
      payload: { email, redirectTo: REDIRECT_TO },
    });

    const token = tokenFromLastEmail();

    const resetResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { 'content-type': 'application/json' },
      payload: { newPassword, token },
    });

    expect(parseResponse<unknown>(resetResponse).statusCode).toBe(200);

    // New password works
    const signInNew = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: { email, password: newPassword },
    });
    expect(parseResponse<unknown>(signInNew).statusCode).toBe(200);

    // Old password no longer works
    const signInOld = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'content-type': 'application/json' },
      payload: { email, password: originalPassword },
    });
    expect(parseResponse<unknown>(signInOld).statusCode).toBe(401);
  });

  it('rejects an invalid token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { 'content-type': 'application/json' },
      payload: { newPassword, token: 'this-is-not-a-real-token' },
    });

    // Better Auth returns 4xx with an INVALID_TOKEN code for bad/expired tokens.
    const { statusCode, body } = parseResponse<{ code?: string; message?: string }>(response);
    expect(statusCode).toBeGreaterThanOrEqual(400);
    expect(statusCode).toBeLessThan(500);
    expect(body.code ?? body.message).toBeDefined();
  });

  it('rejects a token after it has been consumed', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/request-password-reset',
      headers: { 'content-type': 'application/json' },
      payload: { email, redirectTo: REDIRECT_TO },
    });
    const token = tokenFromLastEmail();

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { 'content-type': 'application/json' },
      payload: { newPassword, token },
    });
    expect(parseResponse<unknown>(first).statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { 'content-type': 'application/json' },
      payload: { newPassword: 'yetAnotherPw3', token },
    });
    expect(parseResponse<unknown>(second).statusCode).toBeGreaterThanOrEqual(400);
  });
});
