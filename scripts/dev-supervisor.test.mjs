import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  controlPaths,
  createControlChannel,
  inspectControl,
  preflight,
  queryControl,
  startSupervised,
  stopSupervised,
} from './dev-supervisor.mjs';

const unixOnly = process.platform === 'win32';

function temporaryCheckout(name = 'checkout') {
  const parent = mkdtempSync(join(tmpdir(), 'app-starter-supervisor-test-'));
  const checkoutRoot = join(parent, name);
  const runtimeRoot = join(parent, 'runtime');
  mkdirSync(checkoutRoot);
  mkdirSync(runtimeRoot);
  writeFileSync(
    join(checkoutRoot, 'project.config.json'),
    `${JSON.stringify({ serverPort: 41_001, webPort: 41_002 })}\n`,
  );
  return { parent, checkoutRoot, runtimeRoot };
}

function mockChild(pid = 73_421) {
  const child = new EventEmitter();
  child.pid = pid;
  return child;
}

async function waitUntil(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
}

async function listen(server, options) {
  server.listen(options);
  await once(server, 'listening');
}

async function closeServer(server) {
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

describe('checkout control identity', { skip: unixOnly }, () => {
  it('is stable across aliases and distinct between canonical checkouts', () => {
    const { parent, checkoutRoot, runtimeRoot } = temporaryCheckout('first');
    const second = join(parent, 'second');
    const alias = join(parent, 'alias');
    mkdirSync(second);
    symlinkSync(checkoutRoot, alias, 'dir');

    assert.equal(
      controlPaths(checkoutRoot, runtimeRoot).socketPath,
      controlPaths(alias, runtimeRoot).socketPath,
    );
    assert.notEqual(
      controlPaths(checkoutRoot, runtimeRoot).socketPath,
      controlPaths(second, runtimeRoot).socketPath,
    );
  });

  it('does not let copied state authenticate across checkouts', async () => {
    const { parent, checkoutRoot: first, runtimeRoot } = temporaryCheckout('first');
    const second = join(parent, 'second');
    mkdirSync(second);
    writeFileSync(
      join(second, 'project.config.json'),
      `${JSON.stringify({ serverPort: 41_003, webPort: 41_004 })}\n`,
    );
    const firstPaths = controlPaths(first, runtimeRoot);
    const secondPaths = controlPaths(second, runtimeRoot);
    const firstChannel = await createControlChannel(firstPaths, () => {});
    mkdirSync(secondPaths.controlDirectory, { recursive: true });
    copyFileSync(firstPaths.tokenPath, secondPaths.tokenPath);

    await assert.rejects(
      stopSupervised({ checkoutRoot: second, runtimeRoot }),
      /No managed development services/,
    );
    assert.equal((await queryControl(firstPaths, 'status')).authenticated, true);
    assert.equal(existsSync(secondPaths.tokenPath), false);

    await firstChannel.close();
  });
});

describe('safe control state handling', { skip: unixOnly }, () => {
  it('removes stale token, socket, and PID-like state only when no listener exists', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    mkdirSync(paths.controlDirectory, { recursive: true });
    writeFileSync(paths.tokenPath, `${JSON.stringify({ pid: process.pid })}\n`, { mode: 0o600 });
    writeFileSync(paths.socketPath, 'stale socket placeholder');

    const result = await inspectControl(paths);

    assert.equal(result.listener, false);
    assert.equal(existsSync(paths.tokenPath), false);
    assert.equal(existsSync(paths.socketPath), false);
  });

  it('publishes random authentication state and socket permissions as owner-only', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    const channel = await createControlChannel(paths, () => {});

    assert.match(readFileSync(paths.tokenPath, 'utf8').trim(), /^[a-f0-9]{64}$/);
    assert.equal(statSync(paths.tokenPath).mode & 0o777, 0o600);
    assert.equal(statSync(paths.socketPath).mode & 0o777, 0o600);
    assert.equal(statSync(paths.controlDirectory).mode & 0o777, 0o700);

    await channel.close();
    assert.equal(existsSync(paths.tokenPath), false);
    assert.equal(existsSync(paths.socketPath), false);
  });

  it('refuses tampered authentication without removing the live listener', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    const channel = await createControlChannel(paths, () => {});
    writeFileSync(paths.tokenPath, `${'0'.repeat(64)}\n`);
    chmodSync(paths.tokenPath, 0o600);

    await assert.rejects(
      preflight({ checkoutRoot, runtimeRoot, checkPort: async () => true }),
      /could not be authenticated/,
    );
    assert.equal(existsSync(paths.socketPath), true);
    assert.equal(existsSync(paths.tokenPath), true);

    await channel.close();
  });

  it('refuses a second start while this checkout is already managed', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    const channel = await createControlChannel(paths, () => {});

    await assert.rejects(
      preflight({ checkoutRoot, runtimeRoot, checkPort: async () => true }),
      /already managed/,
    );
    assert.equal((await queryControl(paths, 'status')).authenticated, true);

    await channel.close();
  });
});

describe('port preflight', { skip: unixOnly }, () => {
  it('refuses an occupied configured port and leaves its listener untouched', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const listener = createServer((socket) => socket.end('still here'));
    await listen(listener, { host: '127.0.0.1', port: 0 });
    const occupiedPort = listener.address().port;
    writeFileSync(
      join(checkoutRoot, 'project.config.json'),
      `${JSON.stringify({ serverPort: occupiedPort, webPort: occupiedPort + 1 })}\n`,
    );

    await assert.rejects(
      preflight({ checkoutRoot, runtimeRoot }),
      new RegExp(`${occupiedPort}.*in use`),
    );
    const client = createConnection({ host: '127.0.0.1', port: occupiedPort });
    let response = '';
    client.on('data', (chunk) => (response += chunk));
    await once(client, 'close');
    assert.equal(response, 'still here');

    await closeServer(listener);
  });

  it('checks both configured ports on every preflight', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const checked = [];

    await preflight({
      checkoutRoot,
      runtimeRoot,
      checkPort: async (port) => {
        checked.push(port);
        return true;
      },
    });
    await preflight({
      checkoutRoot,
      runtimeRoot,
      checkPort: async (port) => {
        checked.push(port);
        return true;
      },
    });

    assert.deepEqual(checked, [41_001, 41_002, 41_001, 41_002]);
  });
});

describe('owned process-group supervision', { skip: unixOnly, concurrency: false }, () => {
  it('spawns a separate process group and stop signals only that owned group', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const child = mockChild();
    const signals = [];
    let spawnOptions;
    const running = startSupervised('turbo', ['run', 'dev'], {
      checkoutRoot,
      runtimeRoot,
      checkPort: async () => true,
      installSignalHandlers: false,
      spawnCommand(_command, _args, options) {
        spawnOptions = options;
        return child;
      },
      killProcess(pid, signal) {
        signals.push([pid, signal]);
        queueMicrotask(() => child.emit('close', 0, null));
      },
    });
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    await waitUntil(() => existsSync(paths.tokenPath));

    assert.deepEqual(await stopSupervised({ checkoutRoot, runtimeRoot }), {
      ok: true,
      status: 'stopping',
    });
    assert.deepEqual(await running, { code: 0, signal: null });
    assert.equal(spawnOptions.detached, true);
    assert.equal(spawnOptions.cwd, paths.canonicalRoot);
    assert.deepEqual(signals, [[-child.pid, 'SIGTERM']]);
  });

  it('forwards SIGINT and SIGTERM to the owned group', async () => {
    for (const [index, signal] of ['SIGINT', 'SIGTERM'].entries()) {
      const { checkoutRoot, runtimeRoot } = temporaryCheckout();
      const child = mockChild(73_422 + index);
      const signals = [];
      const running = startSupervised('turbo', [], {
        checkoutRoot,
        runtimeRoot,
        checkPort: async () => true,
        spawnCommand: () => child,
        killProcess(pid, forwardedSignal) {
          signals.push([pid, forwardedSignal]);
          queueMicrotask(() => child.emit('close', null, forwardedSignal));
        },
      });
      await waitUntil(() => existsSync(controlPaths(checkoutRoot, runtimeRoot).tokenPath));

      process.emit(signal);

      assert.deepEqual(await running, { code: null, signal });
      assert.deepEqual(signals, [[-child.pid, signal]]);
    }
  });

  it('escalates an unresponsive owned group from TERM to KILL after a bound', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const child = mockChild(73_424);
    const signals = [];
    const running = startSupervised('turbo', [], {
      checkoutRoot,
      runtimeRoot,
      checkPort: async () => true,
      installSignalHandlers: false,
      terminationGraceMs: 10,
      spawnCommand: () => child,
      killProcess(pid, signal) {
        signals.push([pid, signal]);
        if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, signal));
      },
    });
    await waitUntil(() => existsSync(controlPaths(checkoutRoot, runtimeRoot).tokenPath));

    await stopSupervised({ checkoutRoot, runtimeRoot });
    assert.deepEqual(await running, { code: null, signal: 'SIGKILL' });
    assert.deepEqual(signals, [
      [-child.pid, 'SIGTERM'],
      [-child.pid, 'SIGKILL'],
    ]);
  });

  it('cleans control state when spawn fails or the child exits with an error', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    const spawnErrorChild = mockChild(73_425);
    const spawnFailure = startSupervised('missing-command', [], {
      checkoutRoot,
      runtimeRoot,
      checkPort: async () => true,
      installSignalHandlers: false,
      spawnCommand: () => spawnErrorChild,
    });
    await waitUntil(() => existsSync(paths.tokenPath));
    spawnErrorChild.emit('error', new Error('spawn failed'));

    await assert.rejects(spawnFailure, /spawn failed/);
    assert.equal(existsSync(paths.tokenPath), false);
    assert.equal(existsSync(paths.socketPath), false);

    const failedChild = mockChild(73_426);
    const failedRun = startSupervised('turbo', [], {
      checkoutRoot,
      runtimeRoot,
      checkPort: async () => true,
      installSignalHandlers: false,
      spawnCommand: () => failedChild,
    });
    await waitUntil(() => existsSync(paths.tokenPath));
    failedChild.emit('close', 7, null);
    assert.deepEqual(await failedRun, { code: 7, signal: null });
    assert.equal(existsSync(paths.tokenPath), false);
    assert.equal(existsSync(paths.socketPath), false);
  });
});
