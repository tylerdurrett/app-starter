import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  analyzeRogueLogSuffix,
  assertComposeCleanupOwnership,
  assertDistinctResources,
  assertEmptyComposePrestate,
  assertRogueProof,
  assertRogueSilent,
  composeCleanupEligible,
  logSuffix,
  readConfigSource,
  runBounded,
} from './clean-clone-e2e.mjs';

describe('clean-clone E2E assertions', () => {
  it('validates every generated checkout port', () => {
    assert.deepEqual(readConfigSource('{"serverPort":5101,"dbPort":5151,"webPort":5201}'), {
      serverPort: 5101,
      dbPort: 5151,
      webPort: 5201,
    });
    assert.throws(
      () => readConfigSource('{"serverPort":5101,"dbPort":0,"webPort":5201}', 'clone-a'),
      /clone-a: dbPort must be an integer/,
    );
  });

  it('accepts only an exact append-only rogue log baseline', () => {
    assert.equal(logSuffix('ready\n', 'ready\ncheckpoint\n'), 'checkpoint\n');
    assert.equal(
      logSuffix(
        { stdout: 'out ready\n', stderr: 'err ready\n' },
        { stdout: 'out ready\nout next\n', stderr: 'err ready\nerr next\n' },
      ),
      'out next\nerr next\n',
    );
    assert.throws(() => logSuffix('ready\n', 'different\n'), /cannot prove silence/);
  });

  it('counts post-baseline connections, statements, and application tables', () => {
    assert.deepEqual(
      analyzeRogueLogSuffix(
        'connection received: host=127.0.0.1\nstatement: CREATE TABLE users (id text)\n',
      ),
      { connectionCount: 1, statementCount: 1, applicationTableCount: 1 },
    );
    assert.deepEqual(assertRogueSilent('ready\n', 'ready\ncheckpoint complete\n'), {
      suffix: 'checkpoint complete\n',
      connectionCount: 0,
      statementCount: 0,
      applicationTableCount: 0,
    });
    assert.throws(
      () => assertRogueSilent('ready\n', 'ready\nstatement: CREATE TABLE users (id text)\n'),
      /Expected values to be strictly deep-equal/,
    );
  });

  it('rejects shutdown-only rogue logs when the exact listener is no longer running', () => {
    const rogue = {
      containerId: 'rogue-id',
      name: 'rogue-name',
      runId: 'rogue-run',
    };
    const inspection = {
      Id: rogue.containerId,
      Name: `/${rogue.name}`,
      Config: { Labels: { 'app-starter.clean-clone-e2e': rogue.runId } },
      State: { Running: false, Status: 'exited' },
      HostConfig: {
        PortBindings: {
          '5432/tcp': [5100, 5150, 5200].map((port) => ({
            HostIp: '127.0.0.1',
            HostPort: String(port),
          })),
        },
      },
    };

    assert.throws(
      () =>
        assertRogueProof(
          rogue,
          inspection,
          'ready\n',
          'ready\nreceived fast shutdown request\ndatabase system is shut down\n',
        ),
      /must still be running/,
    );
  });

  it('bounds child commands and stops only the process group it spawned', async () => {
    await assert.rejects(
      runBounded(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        label: 'bounded-test-child',
        timeoutMs: 25,
        echo: false,
      }),
      /timed out after 25ms/,
    );
  });

  it('requires checkout-specific Compose containers and volumes', () => {
    const first = {
      project: 'app-starter-a',
      containerId: 'container-a',
      containerName: 'app-starter-a-postgres-1',
      volumes: ['app-starter-a_pgdata'],
    };
    const second = {
      project: 'app-starter-b',
      containerId: 'container-b',
      containerName: 'app-starter-b-postgres-1',
      volumes: ['app-starter-b_pgdata'],
    };
    assert.doesNotThrow(() => assertDistinctResources(first, second));
    assert.throws(
      () => assertDistinctResources(first, { ...second, volumes: first.volumes }),
      /volume names must differ/,
    );
  });

  it('requires an empty Compose prestate before cleanup becomes eligible', () => {
    const empty = { containers: [], volumes: [], networks: [] };
    assert.doesNotThrow(() => assertEmptyComposePrestate(empty, 'app-starter-clean'));
    assert.throws(
      () =>
        assertEmptyComposePrestate(
          { ...empty, containers: ['preexisting-container'] },
          'app-starter-collision',
        ),
      /Compose resources already exist/,
    );
    assert.equal(
      composeCleanupEligible({
        cleanup: { prestateEmpty: false, goAttempted: true, owned: null },
      }),
      false,
    );
  });

  it('permits partial-go cleanup only for resources with the checkout ownership labels', () => {
    const checkout = {
      label: 'clone-a',
      root: '/tmp/clone-a',
      cleanup: {
        project: 'app-starter-clone-a',
        prestateEmpty: true,
        goAttempted: true,
        owned: null,
      },
    };
    const resources = {
      containers: [
        {
          Id: 'partial-container',
          Config: {
            Labels: {
              'com.docker.compose.project': checkout.cleanup.project,
              'com.docker.compose.project.working_dir': checkout.root,
            },
          },
        },
      ],
      volumes: [
        {
          Name: 'partial-volume',
          Labels: { 'com.docker.compose.project': checkout.cleanup.project },
        },
      ],
      networks: [
        {
          Id: 'partial-network',
          Labels: { 'com.docker.compose.project': checkout.cleanup.project },
        },
      ],
    };

    assert.doesNotThrow(() => assertComposeCleanupOwnership(checkout, resources));
    assert.throws(
      () =>
        assertComposeCleanupOwnership(checkout, {
          ...resources,
          networks: [
            {
              Id: 'collision',
              Labels: { 'com.docker.compose.project': 'somebody-elses-project' },
            },
          ],
        }),
      /ownership label changed/,
    );
  });

  it('revalidates positively observed Compose container and volume identities', () => {
    const checkout = {
      label: 'clone-a',
      root: '/tmp/clone-a',
      cleanup: {
        project: 'app-starter-clone-a',
        prestateEmpty: true,
        goAttempted: true,
        owned: { containerId: 'owned-container', volumes: ['owned-volume'] },
      },
    };
    const labels = { 'com.docker.compose.project': checkout.cleanup.project };
    const resources = {
      containers: [
        {
          Id: 'replacement-container',
          Config: {
            Labels: {
              ...labels,
              'com.docker.compose.project.working_dir': checkout.root,
            },
          },
        },
      ],
      volumes: [{ Name: 'owned-volume', Labels: labels }],
      networks: [],
    };

    assert.throws(
      () => assertComposeCleanupOwnership(checkout, resources),
      /owned container identity changed/,
    );
  });
});
