import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { oauthProvider } from '@better-auth/oauth-provider';
import { db } from '@repo/db';
import * as schema from '@repo/db';
import { PASSWORD_MIN_LENGTH } from '@repo/shared';
import { config } from './config.js';
import { postSignupHooks } from './hooks/post-signup.js';
import { sendEmail } from './email/send.js';
import { resetPasswordEmail, verificationEmail } from './email/templates.js';
import { MCP_SCOPES } from './mcp/scopes.js';

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET environment variable is not set');
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      ...schema,
      // BetterAuth's jwt plugin model is "jwks"; usePlural adds 's' → looks for "jwkss".
      // Our export is `jwks` so we alias it explicitly.
      jwkss: schema.jwks,
    },
    usePlural: true, // Use plural table names (users, sessions, etc.)
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: config.apiOrigin,
  trustedOrigins: [config.webOrigin],
  // oauthProvider takes over the /token endpoint
  disabledPaths: ['/token'],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: config.authRequireEmailVerification,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    sendResetPassword: async ({ user, url }) => {
      const { subject, html, text } = resetPasswordEmail({ name: user.name, url });
      // Don't await — Better Auth advises against awaiting to avoid leaking timing signals
      void sendEmail({ to: user.email, subject, html, text });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      const { subject, html, text } = verificationEmail({ name: user.name, url });
      // Verification links contain tokens; never log them or include them in structured logs.
      void sendEmail({ to: user.email, subject, html, text });
    },
  },
  plugins: [
    jwt({
      jwt: {
        issuer: config.apiOrigin,
      },
      disableSettingJwtHeader: true,
    }),
    oauthProvider({
      // Full URLs so redirects reach the web app (separate origin in dev)
      loginPage: `${config.webOrigin}/login`,
      consentPage: `${config.webOrigin}/consent`,
      allowDynamicClientRegistration: false,
      allowUnauthenticatedClientRegistration: false,
      scopes: ['openid', 'profile', 'email', 'offline_access', ...MCP_SCOPES],
      validAudiences: [config.mcpCanonicalUrl],
      accessTokenExpiresIn: 3600,
      refreshTokenExpiresIn: 60 * 60 * 24 * 30,
    }),
  ],
  databaseHooks: postSignupHooks,
});
