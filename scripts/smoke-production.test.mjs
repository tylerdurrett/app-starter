import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';

import {
  assertPortAvailable,
  captureChildOutput,
  createSmokeEnvironment,
  installSignalHandlers,
  runPrerequisites,
  stopChild,
  verifyChildHealth,
  waitForExit,
} from './smoke-production.mjs';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 1234;
  return child;
}

test('smoke environment overrides inherited resolution and database settings', () => {
  const env = createSmokeEnvironment(
    { serverPort: 6100, dbPort: 6150, webPort: 6200 },
    {
      NODE_OPTIONS: '--conditions=development --trace-warnings',
      NODE_ENV: 'production',
      PORT: '9999',
      DB_PORT: '9998',
      DATABASE_URL: 'postgresql://wrong',
      UNRELATED: 'preserved',
    },
  );

  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.PORT, '6100');
  assert.equal(env.DB_PORT, '6150');
  assert.equal(env.DATABASE_URL, 'postgresql://postgres:postgres@127.0.0.1:6150/postgres');
  assert.equal(env.UNRELATED, 'preserved');
});

test('database readiness and migration use the same explicit environment in order', async () => {
  const env = { DB_PORT: '6150', DATABASE_URL: 'postgresql://explicit', NODE_ENV: 'test' };
  const calls = [];
  await runPrerequisites(env, async (command, args, receivedEnv) => {
    calls.push({ command, args, env: receivedEnv });
  });

  assert.deepEqual(calls, [
    { command: process.execPath, args: ['scripts/wait-for-db.mjs'], env },
    {
      command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      args: ['db:migrate'],
      env,
    },
  ]);
  assert.equal(calls[0].env, calls[1].env);
});

test('port guard refuses to run when the configured server port is occupied', async (t) => {
  const listener = createServer();
  await new Promise((resolvePromise, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolvePromise);
  });
  t.after(() => listener.close());

  const address = listener.address();
  assert.equal(typeof address, 'object');
  await assert.rejects(
    assertPortAvailable(address.port),
    new RegExp(`Configured server port ${address.port} is already in use`),
  );
});

test('port guard releases an available port', async () => {
  const probe = createServer();
  await new Promise((resolvePromise, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = probe.address();
  assert.equal(typeof address, 'object');
  await new Promise((resolvePromise) => probe.close(resolvePromise));

  await assertPortAvailable(address.port);
});

test('health is not accepted from a rogue listener when the spawned child exits early', async (t) => {
  const rogue = createHttpServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', db: 'connected' }));
  });
  await new Promise((resolvePromise, reject) => {
    rogue.once('error', reject);
    rogue.listen(0, '127.0.0.1', resolvePromise);
  });
  t.after(() => rogue.close());
  const address = rogue.address();
  assert.equal(typeof address, 'object');

  const child = fakeChild();
  const getLogs = captureChildOutput(child, new PassThrough(), new PassThrough());
  let fetchCalls = 0;
  setImmediate(() => {
    child.stderr.write('child startup failed\n');
    child.exitCode = 1;
    child.emit('exit', 1, null);
  });

  await assert.rejects(
    verifyChildHealth(child, `http://127.0.0.1:${address.port}/health`, 6100, getLogs, {
      fetchHealth: async (...args) => {
        fetchCalls += 1;
        return fetch(...args);
      },
      timeoutMs: 100,
    }),
    /exited before its listen signal.*child startup failed/s,
  );
  assert.equal(fetchCalls, 0);
});

test('health is fetched only after the spawned child emits its listen signal', async () => {
  const child = fakeChild();
  const getLogs = captureChildOutput(child, new PassThrough(), new PassThrough());
  let fetched = false;
  setImmediate(() => {
    child.stdout.write('{"msg":"Server listening at http://127.0.0.1:6100"}\n');
  });

  await verifyChildHealth(child, 'http://127.0.0.1:6100/health', 6100, getLogs, {
    fetchHealth: async () => {
      fetched = true;
      return { status: 200, json: async () => ({ status: 'ok', db: 'connected' }) };
    },
    timeoutMs: 100,
  });
  assert.equal(fetched, true);
});

test('successful exit waits cancel their timeout and restore exit listeners', async () => {
  const child = fakeChild();
  const activeTimers = new Set();
  const timers = {
    setTimeout(callback) {
      const timer = { callback };
      activeTimers.add(timer);
      return timer;
    },
    clearTimeout(timer) {
      activeTimers.delete(timer);
    },
  };
  const baselineListeners = child.listenerCount('exit');
  const waiting = waitForExit(child, 5_000, timers);
  assert.equal(activeTimers.size, 1);
  assert.equal(child.listenerCount('exit'), baselineListeners + 1);

  child.emit('exit', 0, null);
  assert.equal(await waiting, true);
  assert.equal(activeTimers.size, 0);
  assert.equal(child.listenerCount('exit'), baselineListeners);
});

test('normal cleanup resolves promptly without retaining exit listeners', async () => {
  const child = fakeChild();
  const baselineListeners = child.listenerCount('exit');
  child.kill = (signal) => {
    setImmediate(() => {
      child.signalCode = signal;
      child.emit('exit', null, signal);
    });
    return true;
  };

  const started = Date.now();
  await stopChild(child, 500);
  assert.ok(Date.now() - started < 100, 'cleanup waited for its 500ms fallback timer');
  assert.equal(child.listenerCount('exit'), baselineListeners);
});

test('bounded cleanup escalates from SIGTERM to SIGKILL', async () => {
  const child = fakeChild();
  const baselineListeners = child.listenerCount('exit');
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === 'SIGKILL') {
      child.signalCode = signal;
      child.emit('exit', null, signal);
    }
    return true;
  };

  await stopChild(child, 1);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(child.listenerCount('exit'), baselineListeners);
});

test('bounded cleanup reports a child that survives SIGKILL', async () => {
  const child = fakeChild();
  const baselineListeners = child.listenerCount('exit');
  child.kill = () => true;
  await assert.rejects(stopChild(child, 1), /did not exit after SIGKILL/);
  assert.equal(child.listenerCount('exit'), baselineListeners);
});

test('temporary signal handlers stop the child, preserve exit semantics, and are removable', async () => {
  const processLike = new EventEmitter();
  const child = fakeChild();
  let stopped = 0;
  const remove = installSignalHandlers(
    child,
    async () => {
      stopped += 1;
    },
    processLike,
  );

  processLike.emit('SIGINT');
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(stopped, 1);
  assert.equal(processLike.exitCode, 130);

  remove();
  processLike.emit('SIGTERM');
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(stopped, 1);
  assert.equal(processLike.listenerCount('SIGINT'), 0);
  assert.equal(processLike.listenerCount('SIGTERM'), 0);
});

test('signal cleanup failures retain diagnostics and signal exit status', async () => {
  const processLike = new EventEmitter();
  const child = fakeChild();
  const diagnostics = [];
  const originalError = console.error;
  console.error = (...args) => diagnostics.push(args);
  try {
    const remove = installSignalHandlers(
      child,
      async () => {
        throw new Error('cleanup exploded');
      },
      processLike,
    );
    processLike.emit('SIGTERM');
    await new Promise((resolvePromise) => setImmediate(resolvePromise));
    remove();
  } finally {
    console.error = originalError;
  }

  assert.equal(processLike.exitCode, 143);
  assert.match(String(diagnostics[0][0]), /Failed to stop compiled server after SIGTERM/);
  assert.match(String(diagnostics[0][1]), /cleanup exploded/);
});
