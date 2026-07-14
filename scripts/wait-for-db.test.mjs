import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { composeProjectName } from './compose.mjs';
import { resolveDatabaseEnvironment } from './database-env.mjs';
import {
  assertOwnedHealthyContainer,
  findPostgresContainer,
  inspectContainer,
  waitForComposeDatabase,
  waitForDatabase,
  waitForExternalDatabase,
} from './wait-for-db.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function composeResolution(extraEnv = {}) {
  return resolveDatabaseEnvironment({
    config: { dbPort: 6150 },
    fileEnv: extraEnv,
    inheritedEnv: {},
  });
}

function externalResolution(
  databaseUrl = 'postgresql://user:secret@database.example.com:6543/app',
) {
  return resolveDatabaseEnvironment({
    fileEnv: { DATABASE_MODE: 'external', DATABASE_URL: databaseUrl },
    inheritedEnv: {},
  });
}

function healthyInspection(checkoutRoot = repoRoot) {
  return {
    Config: {
      Labels: {
        'com.docker.compose.project': composeProjectName(checkoutRoot),
        'com.docker.compose.service': 'postgres',
      },
    },
    State: { Status: 'running', Health: { Status: 'healthy' } },
  };
}

describe('Compose database readiness', () => {
  it('always starts and validates owned Compose even when another URL looks reachable', async () => {
    const resolved = composeResolution({
      DATABASE_URL: 'postgresql://other-project.example.com:6150/unsafe',
    });
    const calls = [];

    await waitForDatabase(resolved, {
      async runComposeCommand(args, options) {
        calls.push({ args, options });
      },
      async findContainer() {
        return 'owned-container';
      },
      async inspect(containerId) {
        assert.equal(containerId, 'owned-container');
        return healthyInspection();
      },
      async checkReachable() {
        assert.fail('Compose mode must not use a TCP reachability shortcut');
      },
    });

    assert.deepEqual(calls, [
      {
        args: ['up', '-d', '--wait', '--wait-timeout', '30', 'postgres'],
        options: { checkoutRoot: repoRoot, env: resolved.childEnv },
      },
    ]);
  });

  it('stops immediately when Compose startup fails', async () => {
    let inspected = false;
    await assert.rejects(
      waitForComposeDatabase(composeResolution(), {
        async runComposeCommand() {
          throw new Error('port is already allocated');
        },
        async findContainer() {
          inspected = true;
        },
      }),
      /port is already allocated/,
    );
    assert.equal(inspected, false);
  });

  it('fails when Compose cannot identify the service container', async () => {
    await assert.rejects(
      waitForComposeDatabase(composeResolution(), {
        async runComposeCommand() {},
        async findContainer() {
          throw new Error('Compose did not create a Postgres service container');
        },
      }),
      /did not create a Postgres service container/,
    );
  });

  it('queries only the checkout-scoped Postgres service container', async () => {
    const env = { DB_PORT: '6150' };
    const calls = [];
    const containerId = await findPostgresContainer(
      { checkoutRoot: repoRoot, env },
      async (command, args, options) => {
        calls.push({ command, args, options });
        return 'owned-container\n';
      },
    );

    assert.equal(containerId, 'owned-container');
    assert.deepEqual(calls, [
      {
        command: 'docker',
        args: [
          'compose',
          '--project-name',
          composeProjectName(repoRoot),
          'ps',
          '--all',
          '--quiet',
          'postgres',
        ],
        options: { cwd: repoRoot, env },
      },
    ]);
  });

  it('rejects missing or ambiguous Compose service container output', async () => {
    for (const [output, pattern] of [
      ['', /did not create a Postgres service container/],
      ['first\nsecond\n', /Expected one Postgres service container.*found 2/],
    ]) {
      await assert.rejects(
        findPostgresContainer({}, async () => output),
        pattern,
      );
    }
  });

  it('inspects the selected container and requires one valid Docker result', async () => {
    const inspection = healthyInspection();
    const calls = [];
    assert.deepEqual(
      await inspectContainer('owned-container', async (command, args, options) => {
        calls.push({ command, args, options });
        return JSON.stringify([inspection]);
      }),
      inspection,
    );
    assert.deepEqual(calls, [
      {
        command: 'docker',
        args: ['inspect', 'owned-container'],
        options: { cwd: repoRoot, env: process.env },
      },
    ]);

    for (const [output, pattern] of [
      ['not-json', /invalid container inspection data/],
      ['[]', /exactly one container inspection/],
      ['[{}, {}]', /exactly one container inspection/],
    ]) {
      await assert.rejects(
        inspectContainer('owned-container', async () => output),
        pattern,
      );
    }
  });

  it('requires matching project and service ownership labels', () => {
    const expectedProject = composeProjectName(repoRoot);
    const wrongProject = healthyInspection();
    wrongProject.Config.Labels['com.docker.compose.project'] = 'another-project';
    assert.throws(
      () => assertOwnedHealthyContainer(wrongProject, expectedProject),
      /does not belong to this checkout/,
    );

    const wrongService = healthyInspection();
    wrongService.Config.Labels['com.docker.compose.service'] = 'redis';
    assert.throws(
      () => assertOwnedHealthyContainer(wrongService, expectedProject),
      /not the expected Postgres service/,
    );
  });

  it('requires the owned container to be running and healthy', () => {
    const expectedProject = composeProjectName(repoRoot);
    const stopped = healthyInspection();
    stopped.State.Status = 'exited';
    assert.throws(() => assertOwnedHealthyContainer(stopped, expectedProject), /is exited/);

    const unhealthy = healthyInspection();
    unhealthy.State.Health.Status = 'unhealthy';
    assert.throws(() => assertOwnedHealthyContainer(unhealthy, expectedProject), /is unhealthy/);

    const missingHealth = healthyInspection();
    delete missingHealth.State.Health;
    assert.throws(
      () => assertOwnedHealthyContainer(missingHealth, expectedProject),
      /missing a health status/,
    );
  });
});

describe('external database readiness', () => {
  it('polls only the explicitly resolved external endpoint and never runs Compose', async () => {
    const resolved = externalResolution();
    const calls = [];

    await waitForDatabase(resolved, {
      async checkReachable(hostname, port) {
        calls.push({ hostname, port });
        return true;
      },
      async runComposeCommand() {
        assert.fail('External mode must never run Compose');
      },
    });

    assert.deepEqual(calls, [{ hostname: 'database.example.com', port: 6543 }]);
  });

  it('fails with a bounded, credential-free timeout', async () => {
    const secret = 'do-not-log-this-password';
    const resolved = externalResolution(
      `postgresql://admin:${secret}@database.example.com:6543/app`,
    );
    let currentTime = 0;
    let attempts = 0;

    await assert.rejects(
      waitForExternalDatabase(resolved, {
        timeoutMs: 2_500,
        pollIntervalMs: 1_000,
        now: () => currentTime,
        delay: async (ms) => {
          currentTime += ms;
        },
        checkReachable: async () => {
          attempts += 1;
          return false;
        },
      }),
      (error) => {
        assert.match(error.message, /Timed out after 2.5s/);
        assert.match(error.message, /database\.example\.com:6543/);
        assert.doesNotMatch(error.message, new RegExp(secret));
        return true;
      },
    );
    assert.equal(currentTime, 2_500);
    assert.equal(attempts, 3);
  });

  it('uses the resolver-derived child environment in the real script entry point', async () => {
    const server = createServer((socket) => socket.end());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();

    try {
      const result = await execFileAsync(process.execPath, ['scripts/wait-for-db.mjs'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_MODE: 'external',
          DATABASE_URL: `postgresql://user:secret@127.0.0.1:${port}/app`,
        },
      });
      assert.match(
        result.stdout,
        new RegExp(`External Postgres is reachable on 127\\.0\\.0\\.1:${port}`),
      );
      assert.doesNotMatch(result.stdout, /secret/);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('connects to an explicit IPv6 literal without URL brackets', async (context) => {
    const server = createServer((socket) => socket.end());
    try {
      server.listen(0, '::1');
      await once(server, 'listening');
    } catch (error) {
      if (error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT') {
        context.skip('IPv6 loopback is unavailable');
        return;
      }
      throw error;
    }
    const { port } = server.address();

    try {
      const result = await execFileAsync(process.execPath, ['scripts/wait-for-db.mjs'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_MODE: 'external',
          DATABASE_URL: `postgresql://user:secret@[::1]:${port}/app`,
        },
      });
      assert.match(
        result.stdout,
        new RegExp(`External Postgres is reachable on \\[::1\\]:${port}`),
      );
      assert.doesNotMatch(result.stdout, /secret|\[\[::1\]\]/);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
