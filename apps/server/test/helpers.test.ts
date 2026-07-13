import { describe, expect, it } from 'vitest';

import {
  closeTestServers,
  createProjectViaHttp,
  createProjectViaService,
  createTestServer,
  createWorkspaceViaHttp,
  createWorkspaceViaService,
  parseResponse,
  signUp,
  trackTestServer,
} from './helpers.js';

describe('server fixture lifecycle', () => {
  it('loads before building and tracks custom servers', async () => {
    const events: string[] = [];
    const server = await createTestServer({
      loadServer: async () => {
        events.push('load');
        return { value: 42 };
      },
      buildServer: async ({ value }) => {
        events.push(`build:${value}`);
        return {
          close() {
            events.push('close');
          },
        };
      },
    });

    expect(server).toBeDefined();
    await closeTestServers();
    expect(events).toEqual(['load', 'build:42', 'close']);
  });

  it('attempts every registered close and aggregates failures', async () => {
    const closed: string[] = [];
    trackTestServer({
      async close() {
        closed.push('first');
        throw new Error('first close failed');
      },
    });
    trackTestServer({
      async close() {
        closed.push('second');
        throw new Error('second close failed');
      },
    });

    const failure = closeTestServers();
    await expect(failure).rejects.toBeInstanceOf(AggregateError);
    await expect(failure).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: 'first close failed' }),
        expect.objectContaining({ message: 'second close failed' }),
      ],
    });
    expect(closed).toEqual(['first', 'second']);
  });
});

describe('server fixture factories', () => {
  it('keeps endpoint and service-backed creation explicit', async () => {
    const app = await createTestServer();
    await app.ready();

    const user = await signUp(app, 'fixture-owner@test.com', 'Fixture Owner');
    expect(user.statusCode).toBe(200);
    expect(user.body.user.id).toBe(user.userId);

    const workspace = await createWorkspaceViaHttp(app, user.cookie, 'HTTP Workspace');
    expect(workspace.statusCode).toBe(201);
    expect(workspace.body.name).toBe('HTTP Workspace');

    const project = await createProjectViaHttp(
      app,
      user.cookie,
      workspace.body.slug,
      'HTTP Project',
    );
    expect(project.statusCode).toBe(201);
    expect(project.body.workspaceId).toBe(workspace.body.id);

    const serviceWorkspace = await createWorkspaceViaService('Service Workspace', user.userId);
    const serviceProject = await createProjectViaService(
      'Service Project',
      serviceWorkspace.id,
      user.userId,
    );
    expect(serviceProject).toMatchObject({
      name: 'Service Project',
      workspaceId: serviceWorkspace.id,
    });
  });

  it('returns parsed response bodies with their status', () => {
    const response = {
      statusCode: 202,
      body: JSON.stringify({ accepted: true }),
    };
    const parsed = parseResponse<{ accepted: boolean }>(response as never);

    expect(parsed).toMatchObject({ statusCode: 202, body: { accepted: true } });
    expect(parsed.response).toBe(response);
  });
});
