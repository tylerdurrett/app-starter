import { expect } from 'vitest';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

interface ServiceErrorLike extends Error {
  code: string;
}

export interface CloseableTestServer {
  close(): void | Promise<unknown>;
}

type DefaultServerModule = typeof import('../src/index.js');

export interface TestServerOptions<
  ServerModule = DefaultServerModule,
  Server extends CloseableTestServer = FastifyInstance,
> {
  loadServer?: () => Promise<ServerModule>;
  buildServer?: (serverModule: ServerModule) => Server | Promise<Server>;
}

export interface ParsedResponse<Body> {
  response: LightMyRequestResponse;
  statusCode: number;
  body: Body;
}

export interface SignUpBody {
  user: {
    id: string;
    email: string;
    name: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SignedUpUser extends ParsedResponse<SignUpBody> {
  userId: string;
  cookie: string;
}

export interface WorkspaceBody {
  id: string;
  name: string;
  slug: string;
  [key: string]: unknown;
}

export interface ProjectBody {
  id: string;
  name: string;
  slug: string;
  workspaceId: string;
  [key: string]: unknown;
}

const serverRegistryKey = Symbol.for('app-starter.server-test.instances');

function serverRegistry(): Set<CloseableTestServer> {
  const globals = globalThis as typeof globalThis & {
    [serverRegistryKey]?: Set<CloseableTestServer>;
  };
  return (globals[serverRegistryKey] ??= new Set());
}

export function trackTestServer<Server extends CloseableTestServer>(server: Server): Server {
  serverRegistry().add(server);
  return server;
}

export async function closeTestServers(): Promise<void> {
  const servers = [...serverRegistry()];
  serverRegistry().clear();
  const results = await Promise.allSettled(servers.map(async (server) => server.close()));
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));

  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Multiple test servers failed to close');
}

export async function createTestServer<
  ServerModule = DefaultServerModule,
  Server extends CloseableTestServer = FastifyInstance,
>(options: TestServerOptions<ServerModule, Server> = {}): Promise<Server> {
  const loadServer =
    options.loadServer ?? (async () => import('../src/index.js') as Promise<ServerModule>);
  const serverModule = await loadServer();
  const buildServer =
    options.buildServer ??
    ((module: ServerModule) => (module as DefaultServerModule).buildServer() as unknown as Server);

  return trackTestServer(await buildServer(serverModule));
}

export function expectServiceError(
  error: unknown,
  code: string,
  options?: { messageIncludes?: string },
): ServiceErrorLike {
  expect(error).toBeInstanceOf(Error);

  const serviceError = error as Error & { code?: unknown };
  expect(serviceError.name).toBe('ServiceError');
  expect(serviceError.code).toBe(code);

  if (options?.messageIncludes) {
    expect(serviceError.message).toContain(options.messageIncludes);
  }

  return serviceError as ServiceErrorLike;
}

export function parseJsonBody<T>(response: { body: string }): T {
  return JSON.parse(response.body) as T;
}

export function parseResponse<Body>(response: LightMyRequestResponse): ParsedResponse<Body> {
  return {
    response,
    statusCode: response.statusCode,
    body: parseJsonBody<Body>(response),
  };
}

function firstCookie(response: LightMyRequestResponse): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error('Sign-up response did not set a session cookie');
  return value.split(';', 1)[0] as string;
}

export async function signUp(
  server: FastifyInstance,
  email: string,
  name: string,
  password = 'password123',
): Promise<SignedUpUser> {
  const parsed = parseResponse<SignUpBody>(
    await server.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json' },
      payload: { email, password, name },
    }),
  );

  return {
    ...parsed,
    userId: parsed.body.user.id,
    cookie: firstCookie(parsed.response),
  };
}

export async function createWorkspaceViaHttp(
  server: FastifyInstance,
  cookie: string,
  name: string,
): Promise<ParsedResponse<WorkspaceBody>> {
  return parseResponse<WorkspaceBody>(
    await server.inject({
      method: 'POST',
      url: '/api/workspaces',
      headers: { 'content-type': 'application/json', cookie },
      payload: { name },
    }),
  );
}

export async function createProjectViaHttp(
  server: FastifyInstance,
  cookie: string,
  workspaceSlug: string,
  name: string,
): Promise<ParsedResponse<ProjectBody>> {
  return parseResponse<ProjectBody>(
    await server.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { 'content-type': 'application/json', cookie },
      payload: { workspaceSlug, name },
    }),
  );
}

export async function createWorkspaceViaService(name: string, ownerUserId: string) {
  const { createWorkspace } = await import('../src/workspaces/service.js');
  return createWorkspace({ name, ownerUserId });
}

export async function createProjectViaService(
  name: string,
  workspaceId: string,
  ownerUserId: string,
) {
  const { createProject } = await import('../src/projects/service.js');
  return createProject({ name, workspaceId, ownerUserId });
}
