// config must be imported first — it loads .env before @repo/db reads DATABASE_URL
import { config, type TrustProxyPolicy } from './config.js';
import { ping } from '@repo/db';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import healthRoutes from './routes/health.js';
import wellKnownRoutes from './routes/well-known.js';
import projectRoutes from './routes/projects.js';
import projectInviteRoutes from './routes/project-invites.js';
import workspaceRoutes from './routes/workspaces.js';
import workspaceInviteRoutes from './routes/workspace-invites.js';
import integrationRoutes from './routes/integrations.js';
import meRoutes from './routes/me.js';
import mcpPlugin from './mcp/plugin.js';
import { auth } from './auth.js';
import { HttpError } from './auth/require-permission.js';
import { ServiceError } from './workspaces/service.js';
import { ServiceError as ProjectServiceError } from './projects/service.js';
import { ServiceError as IntegrationServiceError } from './integrations/service.js';
import type { DbProbe } from './routes/health.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export type { DbProbe };

export interface BuildServerOpts {
  dbProbe?: DbProbe;
  loggerStream?: { write(msg: string): void };
  trustProxy?: TrustProxyPolicy;
}

export const BODY_LIMIT_BYTES = 1024 * 1024;
export const HSTS_MAX_AGE_SECONDS = 31536000;
export const GLOBAL_RATE_LIMIT_MAX = 300;
export const AUTH_RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_TIME_WINDOW = '1 minute';
export const LOG_REDACTION_CENSOR = '[Redacted]';

const sensitiveLogFields = [
  'signingSecret',
  'botToken',
  'access_token',
  'refresh_token',
  'id_token',
  'accessToken',
  'refreshToken',
  'idToken',
  'clientSecret',
  'client_secret',
  'password',
  'token',
] as const;

const nestedSensitiveLogFieldPaths = sensitiveLogFields.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
  `*.*.*.${field}`,
]);

export const LOG_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'res.headers["set-cookie"]',
  'reply.headers["set-cookie"]',
  'response.headers["set-cookie"]',
  'headers["set-cookie"]',
  ...nestedSensitiveLogFieldPaths,
] as const;

export const SERVER_LOGGER_OPTIONS = {
  // Production logs flow through Render and future drains; redact session,
  // OAuth, and integration secrets at serialization time to prevent leaks.
  redact: {
    paths: [...LOG_REDACTION_PATHS],
    censor: LOG_REDACTION_CENSOR,
  },
};

const stricterAuthRateLimitedRoutes = [
  '/api/auth/sign-in/email',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/oauth2/token',
] as const;

async function handleBetterAuthRequest(request: FastifyRequest, reply: FastifyReply) {
  // Build BetterAuth requests from the configured public origin so
  // TLS-terminated dev/prod proxies do not leak backend HTTP origins into
  // OAuth redirects or issuer-sensitive flows.
  const url = new URL(request.url, config.apiOrigin);

  // Preserve form-encoded bodies for BetterAuth (e.g. OAuth 2.1 token endpoint)
  let body: string | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const ct = request.headers['content-type'] || '';
    if (ct.startsWith('application/x-www-form-urlencoded') && typeof request.body === 'object') {
      body = new URLSearchParams(request.body as Record<string, string>).toString();
    } else {
      body = JSON.stringify(request.body);
    }
  }

  const webRequest = new Request(url.toString(), {
    method: request.method,
    headers: request.headers as HeadersInit,
    body,
  });

  // Process with Better Auth
  const response = await auth.handler(webRequest);

  // Send the response
  reply.code(response.status);

  // Set response headers — use getSetCookie() for set-cookie to avoid
  // the Headers spec collapsing multiple cookies into one comma-joined value
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') reply.header(key, value);
  });
  for (const cookie of response.headers.getSetCookie()) {
    reply.header('set-cookie', cookie);
  }

  // Send response body
  const responseBody = await response.text();
  reply.send(responseBody);
}

export function buildServer(opts?: BuildServerOpts) {
  const app = Fastify({
    logger: opts?.loggerStream
      ? { ...SERVER_LOGGER_OPTIONS, stream: opts.loggerStream }
      : SERVER_LOGGER_OPTIONS,
    trustProxy: opts?.trustProxy ?? config.trustProxy,
    bodyLimit: BODY_LIMIT_BYTES,
  });

  app.register(rateLimit, {
    max: GLOBAL_RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_TIME_WINDOW,
    keyGenerator: (request) => request.ip,
    // V1 uses the plugin's in-memory store for one Render API process.
    // Use Redis before scaling to multiple API replicas so limits are shared.
  });

  app.after((err) => {
    if (err) throw err;
    registerServerRoutes(app, opts);
  });

  return app;
}

function registerServerRoutes(app: FastifyInstance, opts?: BuildServerOpts) {
  app.register(helmet, {
    // HSTS is production-only because browsers cache it and can force local
    // HTTP development hosts onto HTTPS after a single response.
    strictTransportSecurity: process.env.NODE_ENV === 'production'
      ? { maxAge: HSTS_MAX_AGE_SECONDS, includeSubDomains: true }
      : false,
    xFrameOptions: { action: 'deny' },
  });

  // Configure CORS with credentials support
  // Explicit methods list required — @fastify/cors defaults to GET,HEAD,POST only
  app.register(cors, {
    origin: config.webOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // OAuth 2.1 token endpoint requires application/x-www-form-urlencoded
  app.register(formbody);

  app.register(healthRoutes, { dbProbe: opts?.dbProbe ?? { ping } });
  app.register(wellKnownRoutes);
  app.register(projectRoutes);
  app.register(projectInviteRoutes);
  app.register(workspaceRoutes);
  app.register(workspaceInviteRoutes);
  app.register(integrationRoutes);
  app.register(meRoutes);
  app.register(mcpPlugin);

  // Map HttpError and ServiceError to structured JSON responses
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    if (error instanceof ServiceError || error instanceof ProjectServiceError || error instanceof IntegrationServiceError) {
      const statusMap: Record<ServiceError['code'] | IntegrationServiceError['code'], number> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        CONFLICT: 409,
        BAD_REQUEST: 400,
        VALIDATION: 400,
      };
      const errorCode = 'code' in error ? error.code : 'BAD_REQUEST';
      return reply.status(statusMap[errorCode] ?? 500).send({ error: error.message });
    }
    const statusCode = error instanceof Error && 'statusCode' in error
      ? (error as Error & { statusCode: number }).statusCode
      : 500;
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    reply.status(statusCode).send({ error: message });
  });

  // Mount Better Auth routes
  for (const url of stricterAuthRateLimitedRoutes) {
    app.post(url, {
      config: {
        rateLimit: {
          max: AUTH_RATE_LIMIT_MAX,
          timeWindow: RATE_LIMIT_TIME_WINDOW,
        },
      },
    }, handleBetterAuthRequest);
  }

  // Register catch-all route for /api/auth/*
  app.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    url: '/api/auth/*',
    handler: handleBetterAuthRequest,
  });
}
