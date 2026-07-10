import { pgTable, text, timestamp, boolean, check, index, unique, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// --- Users and Auth ---

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  lastActiveProjectId: text('last_active_project_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id),
});

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at'),
  password: text('password'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// --- Workspaces (top-level) ---

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const workspaceMemberships = pgTable('workspace_memberships', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  role: text('role').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique('workspace_memberships_workspace_user_unique').on(t.workspaceId, t.userId),
  index('workspace_memberships_user_id_idx').on(t.userId),
  check('workspace_membership_role_check', sql`${t.role} IN ('owner', 'manager', 'member')`),
]);

export const workspaceInvites = pgTable('workspace_invites', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  status: text('status').notNull().default('pending'),
  invitedByUserId: text('invited_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('workspace_invites_workspace_email_idx').on(t.workspaceId, t.email),
  check('workspace_invite_role_check', sql`${t.role} IN ('manager', 'member')`),
  check('workspace_invite_status_check', sql`${t.status} IN ('pending', 'accepted', 'revoked')`),
]);

// --- Projects (formerly workspaces) ---

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  unique('projects_workspace_id_slug_unique').on(t.workspaceId, t.slug),
]);

export const projectMemberships = pgTable('project_memberships', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  role: text('role').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  unique('project_memberships_project_user_unique').on(t.projectId, t.userId),
  index('project_memberships_user_id_idx').on(t.userId),
  check('project_membership_role_check', sql`${t.role} IN ('owner', 'manager', 'member')`),
]);

export const projectInvites = pgTable('project_invites', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  status: text('status').notNull().default('pending'),
  invitedByUserId: text('invited_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('project_invites_project_email_idx').on(t.projectId, t.email),
  check('project_invite_role_check', sql`${t.role} IN ('manager', 'member')`),
  check('project_invite_status_check', sql`${t.status} IN ('pending', 'accepted', 'revoked')`),
]);

// --- Integrations ---

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  config: jsonb('config').notNull().default({}),
  status: text('status').notNull().default('pending'),
  lastTestedAt: timestamp('last_tested_at'),
  lastTestError: text('last_test_error'),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('integrations_workspace_id_idx').on(t.workspaceId),
  check('integration_status_check', sql`${t.status} IN ('pending', 'active', 'error')`),
]);

export type IntegrationsInsertType = typeof integrations.$inferInsert;
export type IntegrationsSelectType = typeof integrations.$inferSelect;

// --- OAuth Provider (BetterAuth oauthProvider plugin) ---

export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  disabled: boolean('disabled').default(false),
  skipConsent: boolean('skip_consent'),
  enableEndSession: boolean('enable_end_session'),
  subjectType: text('subject_type'),
  scopes: jsonb('scopes'),
  userId: text('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  name: text('name'),
  uri: text('uri'),
  icon: text('icon'),
  contacts: jsonb('contacts'),
  tos: text('tos'),
  policy: text('policy'),
  softwareId: text('software_id'),
  softwareVersion: text('software_version'),
  softwareStatement: text('software_statement'),
  redirectUris: jsonb('redirect_uris').notNull(),
  postLogoutRedirectUris: jsonb('post_logout_redirect_uris'),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
  grantTypes: jsonb('grant_types'),
  responseTypes: jsonb('response_types'),
  public: boolean('public'),
  type: text('type'),
  requirePKCE: boolean('require_pkce'),
  referenceId: text('reference_id'),
  metadata: jsonb('metadata'),
});

export const oauthRefreshTokens = pgTable('oauth_refresh_tokens', {
  id: text('id').primaryKey(),
  token: text('token').notNull(),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  userId: text('user_id').notNull().references(() => users.id),
  referenceId: text('reference_id'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  revoked: timestamp('revoked'),
  authTime: timestamp('auth_time'),
  scopes: jsonb('scopes').notNull(),
});

export const oauthAccessTokens = pgTable('oauth_access_tokens', {
  id: text('id').primaryKey(),
  token: text('token').unique(),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  userId: text('user_id').references(() => users.id),
  referenceId: text('reference_id'),
  refreshId: text('refresh_id').references(() => oauthRefreshTokens.id),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  scopes: jsonb('scopes').notNull(),
});

export const oauthConsents = pgTable('oauth_consents', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => oauthClients.clientId),
  userId: text('user_id').references(() => users.id),
  referenceId: text('reference_id'),
  scopes: jsonb('scopes').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// --- JWT (BetterAuth jwt plugin) ---

export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'),
});