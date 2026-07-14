import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import {
  chmodSync,
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

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

async function availablePort() {
  const server = createServer();
  await listen(server, { host: '127.0.0.1', port: 0 });
  const port = server.address().port;
  await closeServer(server);
  return port;
}

function makeCliCheckout(parent, name, serverPort, webPort) {
  const checkoutRoot = join(parent, name);
  const scriptsDirectory = join(checkoutRoot, 'scripts');
  mkdirSync(scriptsDirectory, { recursive: true });
  const pendingScripts = ['dev-supervisor.mjs'];
  const databaseEnvironmentSource = new URL('database-env.mjs', import.meta.url);
  if (existsSync(databaseEnvironmentSource)) {
    pendingScripts.push('database-env.mjs');
  }
  const copiedScripts = new Set();
  while (pendingScripts.length > 0) {
    const script = pendingScripts.pop();
    if (copiedScripts.has(script)) continue;
    copiedScripts.add(script);
    const source = new URL(script, import.meta.url);
    const destination = join(scriptsDirectory, script);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);

    const contents = readFileSync(source, 'utf8');
    for (const match of contents.matchAll(/(?:from\s+|import\s*)['"](\.\/[^'"]+)['"]/g)) {
      pendingScripts.push(match[1].slice(2));
    }
  }
  if (existsSync(databaseEnvironmentSource)) {
    assert.equal(existsSync(join(scriptsDirectory, 'database-env.mjs')), true);
  }
  writeFileSync(
    join(checkoutRoot, 'project.config.json'),
    `${JSON.stringify({ serverPort, webPort })}\n`,
  );
  symlinkSync(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(checkoutRoot, 'node_modules'),
    'dir',
  );
  return checkoutRoot;
}

async function rawControlRequest(socketPath, request) {
  const client = createConnection(socketPath);
  let response = '';
  client.on('data', (chunk) => (response += chunk));
  await once(client, 'connect');
  client.end(request);
  await once(client, 'close');
  return JSON.parse(response.trim());
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

  it('does not follow a copied public socket and token into another checkout', async () => {
    const { parent, checkoutRoot: first, runtimeRoot } = temporaryCheckout('first');
    const second = join(parent, 'second');
    mkdirSync(second);
    writeFileSync(
      join(second, 'project.config.json'),
      `${JSON.stringify({ serverPort: 41_003, webPort: 41_004 })}\n`,
    );
    const firstPaths = controlPaths(first, runtimeRoot);
    const secondPaths = controlPaths(second, runtimeRoot);
    let firstStops = 0;
    const firstChannel = await createControlChannel(firstPaths, () => firstStops++);
    mkdirSync(secondPaths.controlDirectory, { recursive: true });
    copyFileSync(firstPaths.tokenPath, secondPaths.tokenPath);
    symlinkSync(readlinkSync(firstPaths.socketPath), secondPaths.socketPath);

    await assert.rejects(
      stopSupervised({ checkoutRoot: second, runtimeRoot }),
      /No managed development services/,
    );
    assert.equal(firstStops, 0);
    assert.equal((await queryControl(firstPaths, 'status')).authenticated, true);

    await firstChannel.close();
  });

  it('does not follow a copied owner lock and token into another checkout', async () => {
    const { parent, checkoutRoot: first, runtimeRoot } = temporaryCheckout('first');
    const second = join(parent, 'second');
    mkdirSync(second);
    writeFileSync(
      join(second, 'project.config.json'),
      `${JSON.stringify({ serverPort: 41_003, webPort: 41_004 })}\n`,
    );
    const firstPaths = controlPaths(first, runtimeRoot);
    const secondPaths = controlPaths(second, runtimeRoot);
    let firstStops = 0;
    const firstChannel = await createControlChannel(firstPaths, () => firstStops++);
    mkdirSync(secondPaths.controlDirectory, { recursive: true });
    copyFileSync(firstPaths.tokenPath, secondPaths.tokenPath);
    cpSync(firstPaths.lockDirectory, secondPaths.lockDirectory, { recursive: true });

    await assert.rejects(
      stopSupervised({ checkoutRoot: second, runtimeRoot }),
      /No managed development services/,
    );
    assert.equal(firstStops, 0);
    assert.equal((await queryControl(firstPaths, 'status')).authenticated, true);

    rmSync(secondPaths.controlDirectory, { recursive: true, force: true });
    await firstChannel.close();
  });
});

describe('CLI checkout identity', { skip: unixOnly, concurrency: false }, () => {
  it('ignores inherited checkout and runtime overrides from another checkout', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'app-starter-supervisor-cli-'));
    const first = makeCliCheckout(parent, 'first', await availablePort(), await availablePort());
    const second = makeCliCheckout(parent, 'second', await availablePort(), await availablePort());
    const firstScript = join(first, 'scripts', 'dev-supervisor.mjs');
    const secondScript = join(second, 'scripts', 'dev-supervisor.mjs');
    const spoofedRuntime = join(parent, 'spoofed-runtime');
    mkdirSync(spoofedRuntime);
    const firstPaths = controlPaths(first);
    const supervisor = spawn(
      process.execPath,
      [firstScript, 'start', '--', process.execPath, '-e', 'setInterval(() => {}, 1000)'],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let supervisorError = '';
    supervisor.stderr.on('data', (chunk) => (supervisorError += chunk));

    try {
      try {
        await waitUntil(() => existsSync(firstPaths.tokenPath), 3_000);
      } catch {
        throw new Error(
          `Supervisor did not start with scripts [${readdirSync(join(first, 'scripts')).join(', ')}]: ${supervisorError.trim()}`,
        );
      }
      const spoofedStop = spawnSync(process.execPath, [secondScript, 'stop'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_STARTER_CHECKOUT_ROOT: first,
          APP_STARTER_RUNTIME_ROOT: spoofedRuntime,
          APP_STARTER_DEV_RUNTIME_ROOT: spoofedRuntime,
        },
      });

      assert.equal(spoofedStop.status, 1);
      assert.match(spoofedStop.stderr, /No managed development services/);
      assert.equal((await queryControl(firstPaths, 'status')).authenticated, true);
      assert.deepEqual(readdirSync(spoofedRuntime), []);

      const supervisorClosed = once(supervisor, 'close');
      const realStop = spawnSync(process.execPath, [firstScript, 'stop'], { encoding: 'utf8' });
      assert.equal(realStop.status, 0, realStop.stderr);
      const [code, signal] = await supervisorClosed;
      assert.deepEqual({ code, signal }, { code: 143, signal: null });
      assert.equal(existsSync(firstPaths.tokenPath), false);
    } finally {
      try {
        if (supervisor.exitCode === null && supervisor.signalCode === null) {
          const supervisorClosed = once(supervisor, 'close');
          const cleanupStop = spawnSync(process.execPath, [firstScript, 'stop'], {
            encoding: 'utf8',
          });
          if (cleanupStop.status !== 0) supervisor.kill('SIGTERM');
          const closed = await Promise.race([
            supervisorClosed.then(() => true),
            new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 2_000)),
          ]);
          if (!closed && supervisor.exitCode === null && supervisor.signalCode === null) {
            supervisor.kill('SIGKILL');
            await supervisorClosed;
          }
        }
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    }
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

  it('reclaims a crashed supervisor lock only after it is stale and has no listener', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    mkdirSync(paths.lockDirectory, { recursive: true });
    writeFileSync(join(paths.lockDirectory, 'owner'), `${paths.checkoutHash}.${'a'.repeat(64)}\n`, {
      mode: 0o600,
    });
    writeFileSync(paths.tokenPath, `${'b'.repeat(64)}\n`, { mode: 0o600 });
    writeFileSync(paths.socketPath, 'stale socket placeholder');
    const old = new Date(Date.now() - 10_000);
    utimesSync(paths.lockDirectory, old, old);

    const result = await inspectControl(paths);

    assert.equal(result.listener, false);
    assert.equal(existsSync(paths.lockDirectory), false);
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

  it('allows only one channel acquisition under concurrent startup', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, async () => {
        await preflight({ checkoutRoot, runtimeRoot, checkPort: async () => true });
        return createControlChannel(paths, () => {});
      }),
    );
    const channels = attempts
      .filter((attempt) => attempt.status === 'fulfilled')
      .map((attempt) => attempt.value);

    assert.equal(channels.length, 1);
    assert.equal((await queryControl(paths, 'status')).authenticated, true);
    assert.equal(attempts.filter((attempt) => attempt.status === 'rejected').length, 19);

    await channels[0].close();
  });

  it('keeps a live lease authoritative after its public socket is removed', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    const channel = await createControlChannel(paths, () => {});
    const privateSocket = readFileSync(join(paths.lockDirectory, 'socket'), 'utf8').trim();

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_100));
    unlinkSync(paths.socketPath);

    await assert.rejects(
      preflight({ checkoutRoot, runtimeRoot, checkPort: async () => true }),
      /already managed/,
    );
    await assert.rejects(
      createControlChannel(paths, () => {}),
      /already managed/,
    );
    assert.equal(existsSync(paths.lockDirectory), true);
    assert.equal(existsSync(privateSocket), true);

    await channel.close();
    assert.equal(existsSync(paths.lockDirectory), false);
    assert.equal(existsSync(paths.tokenPath), false);
    assert.equal(existsSync(privateSocket), false);
  });

  it('does not unlink a replacement listener it does not own during cleanup', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    const channel = await createControlChannel(paths, () => {});
    unlinkSync(paths.socketPath);
    const replacement = createServer((socket) => socket.end('replacement'));
    await listen(replacement, paths.socketPath);

    await channel.close();

    assert.equal(existsSync(paths.socketPath), true);
    const client = createConnection(paths.socketPath);
    let response = '';
    client.on('data', (chunk) => (response += chunk));
    await once(client, 'close');
    assert.equal(response, 'replacement');
    await closeServer(replacement);
  });

  it('contains malformed unauthenticated requests and keeps serving', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    const channel = await createControlChannel(paths, () => {});

    assert.deepEqual(await rawControlRequest(paths.socketPath, 'null\n'), {
      ok: false,
      error: 'invalid request',
    });
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
    const childEnv = {
      PATH: '/safe-bin',
      APP_STARTER_CHECKOUT_ROOT: '/spoofed-checkout',
      APP_STARTER_RUNTIME_ROOT: '/spoofed-runtime',
      APP_STARTER_DEV_RUNTIME_ROOT: '/spoofed-dev-runtime',
      APP_STARTER_DEV_RUNTIME_DIR: '/spoofed-dev-runtime-dir',
    };
    let spawnOptions;
    const running = startSupervised('turbo', ['run', 'dev'], {
      checkoutRoot,
      runtimeRoot,
      env: childEnv,
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
      groupExists: () => false,
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
    assert.deepEqual(spawnOptions.env, { PATH: '/safe-bin' });
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
        groupExists: () => false,
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
    let groupAlive = true;
    const running = startSupervised('turbo', [], {
      checkoutRoot,
      runtimeRoot,
      checkPort: async () => true,
      installSignalHandlers: false,
      terminationGraceMs: 10,
      spawnCommand: () => child,
      killProcess(pid, signal) {
        signals.push([pid, signal]);
        if (signal === 'SIGKILL') {
          groupAlive = false;
          queueMicrotask(() => child.emit('close', null, signal));
        }
      },
      groupExists: () => groupAlive,
    });
    await waitUntil(() => existsSync(controlPaths(checkoutRoot, runtimeRoot).tokenPath));

    await stopSupervised({ checkoutRoot, runtimeRoot });
    assert.deepEqual(await running, { code: null, signal: 'SIGKILL' });
    assert.deepEqual(signals, [
      [-child.pid, 'SIGTERM'],
      [-child.pid, 'SIGKILL'],
    ]);
  });

  it('keeps state and escalates when the leader exits but a descendant ignores TERM', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    const child = mockChild(73_425);
    const signals = [];
    let groupAlive = true;
    let killDelivered = false;
    const running = startSupervised('turbo', [], {
      checkoutRoot,
      runtimeRoot,
      checkPort: async () => true,
      installSignalHandlers: false,
      terminationGraceMs: 30,
      spawnCommand: () => child,
      killProcess(pid, signal) {
        signals.push([pid, signal]);
        if (signal === 'SIGTERM') queueMicrotask(() => child.emit('close', null, signal));
        if (signal === 'SIGKILL') {
          groupAlive = false;
          killDelivered = true;
        }
      },
      groupExists: () => {
        if (killDelivered) {
          const error = new Error('orphaned group is being reaped');
          error.code = 'EPERM';
          throw error;
        }
        return groupAlive;
      },
    });
    await waitUntil(() => existsSync(paths.tokenPath));

    await stopSupervised({ checkoutRoot, runtimeRoot });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    assert.equal(existsSync(paths.tokenPath), true);

    assert.deepEqual(await running, { code: null, signal: 'SIGTERM' });
    assert.deepEqual(signals, [
      [-child.pid, 'SIGTERM'],
      [-child.pid, 'SIGKILL'],
    ]);
    assert.equal(existsSync(paths.tokenPath), false);
  });

  it('cleans control state when spawn fails or the child exits with an error', async () => {
    const { checkoutRoot, runtimeRoot } = temporaryCheckout();
    const paths = controlPaths(checkoutRoot, runtimeRoot);
    const spawnErrorChild = mockChild(73_426);
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

    const failedChild = mockChild(73_427);
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
