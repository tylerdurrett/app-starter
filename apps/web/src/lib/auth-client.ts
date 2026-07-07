import { createAuthClient } from 'better-auth/react';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL;
if (!SERVER_URL) {
  throw new Error('VITE_SERVER_URL environment variable is required');
}

// Create the auth client with the server's auth endpoint
export const authClient = createAuthClient({
  baseURL: `${SERVER_URL}/api/auth`,
  plugins: [oauthProviderClient()],
});

// Export commonly used hooks and methods for convenience
export const { useSession, signIn, signUp, signOut, requestPasswordReset, resetPassword } = authClient;

// User management methods
export const updateUser = async (data: Record<string, unknown>) => {
  return authClient.$fetch('/update-user', {
    method: 'POST',
    body: data,
  });
};

export const changeEmail = async (newEmail: string, callbackURL?: string) => {
  return authClient.$fetch('/change-email', {
    method: 'POST',
    body: { newEmail, callbackURL },
  });
};

export const changePassword = async (
  currentPassword: string,
  newPassword: string,
  revokeOtherSessions?: boolean
) => {
  return authClient.$fetch('/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword, revokeOtherSessions },
  });
};