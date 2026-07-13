#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { rmSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;

export function readProjectConfig(path = resolve(repoRoot, 'project.config.json')) {
  const config = JSON.parse(readFileSync(path, 'utf8'));
  for (const name of ['serverPort', 'dbPort', 'webPort']) {
    const value = config[name];
    if (!Number.isInteger(value) || value < 1 || value > 65_535) {
      throw new Error(`${name} must be an integer between 1 and 65535 in project.config.json`);
    }
  }
  return config;
}

export function createSmokeEnvironment(config, inherited = process.env) {
  const env = {
    ...inherited,
    NODE_ENV: 'test',
    PORT: String(config.serverPort),
    DB_PORT: String(config.dbPort),
    DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${config.dbPort}/postgres`,
    BETTER_AUTH_URL: `http://127.0.0.1:${config.serverPort}`,
    CORS_ORIGIN: `http://127.0.0.1:${config.webPort}`,
    MCP_CANONICAL_URL: `http://127.0.0.1:${config.serverPort}/mcp`,
    BETTER_AUTH_SECRET: 'production-smoke-secret-at-least-32-characters',
    CREDENTIAL_ENCRYPTION_KEY: '00'.repeat(32),
    AUTH_REQUIRE_EMAIL_VERIFICATION: 'false',
  };
  delete env.NODE_OPTIONS;
  return env;
}

export function assertPortAvailable(port) {
  return new Promise((resolvePromise, reject) => {
    const guard = createServer();
    guard.unref();
    guard.once('error', (error) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Configured server port ${port} is already in use; refusing to test another process`)
          : error,
      );
    });
    guard.listen(port, '127.0.0.1', () => {
      guard.close((error) => (error ? reject(error) : resolvePromise()));
    });
  });
}

export function run(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

export async function runPrerequisites(env, runCommand = run) {
  await runCommand(process.execPath, ['scripts/wait-for-db.mjs'], env);
  await runCommand(pnpm, ['db:migrate'], env);
}

export function captureChildOutput(child, output = process.stdout, errorOutput = process.stderr) {
  let logs = '';
  const capture = (stream, destination) => {
    stream?.on('data', (chunk) => {
      const text = chunk.toString();
      logs += text;
      destination.write(chunk);
    });
  };
  capture(child.stdout, output);
  capture(child.stderr, errorOutput);
  return () => logs;
}

function childFailure(message, getLogs) {
  const logs = getLogs().trim();
  return new Error(logs ? `${message}\nCompiled server output:\n${logs}` : message);
}

export async function waitForChildListen(child, port, getLogs, timeoutMs = START_TIMEOUT_MS) {
  const expected = `Server listening at http://127.0.0.1:${port}`;

  if (getLogs().includes(expected)) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    throw childFailure(
      `Compiled server exited before its listen signal (${child.signalCode ?? child.exitCode})`,
      getLogs,
    );
  }

  await new Promise((resolvePromise, reject) => {
    const onData = () => {
      if (getLogs().includes(expected)) finish(resolvePromise);
    };
    const onError = (error) => finish(() => reject(childFailure(`Compiled server failed: ${error.message}`, getLogs)));
    const onExit = (code, signal) =>
      finish(() =>
        reject(childFailure(`Compiled server exited before its listen signal (${signal ?? code})`, getLogs)),
      );
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(childFailure(`Compiled server did not emit its listen signal within ${timeoutMs}ms`, getLogs)),
        ),
      timeoutMs,
    );
    const finish = (result) => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      result();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

export async function verifyChildHealth(
  child,
  url,
  port,
  getLogs,
  { fetchHealth = fetch, timeoutMs = START_TIMEOUT_MS } = {},
) {
  await waitForChildListen(child, port, getLogs, timeoutMs);
  let response;
  let body;
  try {
    response = await fetchHealth(url, { signal: AbortSignal.timeout(1_000) });
    body = await response.json();
  } catch (error) {
    throw childFailure(`GET /health failed: ${error.message}`, getLogs);
  }
  if (response.status !== 200 || body.status !== 'ok' || body.db !== 'connected') {
    throw childFailure(`GET /health returned ${response.status}: ${JSON.stringify(body)}`, getLogs);
  }
}

export function waitForExit(
  child,
  timeoutMs,
  timers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout },
) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    const finish = (exited) => {
      timers.clearTimeout(timer);
      child.off('exit', onExit);
      resolvePromise(exited);
    };
    const onExit = () => finish(true);
    const timer = timers.setTimeout(() => finish(false), timeoutMs);
    child.once('exit', onExit);
  });
}

export async function stopChild(child, timeoutMs = STOP_TIMEOUT_MS) {
  if (await waitForExit(child, 0)) return;
  child.kill('SIGTERM');
  if (await waitForExit(child, timeoutMs)) return;
  child.kill('SIGKILL');
  if (!(await waitForExit(child, timeoutMs))) {
    throw new Error(`Server process ${child.pid} did not exit after SIGKILL`);
  }
}

export function installSignalHandlers(child, stop = stopChild, processLike = process) {
  const handlers = new Map();
  for (const [signal, exitCode] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    const handler = async () => {
      processLike.exitCode = exitCode;
      try {
        await stop(child);
      } catch (error) {
        console.error(`Failed to stop compiled server after ${signal}:`, error);
      }
    };
    handlers.set(signal, handler);
    processLike.on(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) processLike.off(signal, handler);
  };
}

export async function main() {
  const config = readProjectConfig();
  const env = createSmokeEnvironment(config);
  const healthUrl = `http://127.0.0.1:${config.serverPort}/health`;

  await assertPortAvailable(config.serverPort);
  await runPrerequisites(env);

  for (const output of [
    'packages/db/dist',
    'packages/shared/dist',
    'packages/integrations-core/dist',
    'apps/server/dist',
  ]) {
    rmSync(resolve(repoRoot, output), { recursive: true, force: true });
  }
  await run(pnpm, ['exec', 'turbo', 'run', 'build', '--filter=@repo/server', '--force'], env);

  // NODE_OPTIONS is deliberately absent: this must exercise package default exports.
  const server = spawn(process.execPath, ['apps/server/dist/main.js'], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const getLogs = captureChildOutput(server);
  let stopPromise;
  const stopServer = () => (stopPromise ??= stopChild(server));
  const removeSignalHandlers = installSignalHandlers(server, stopServer);
  let primaryError;
  let cleanupError;
  try {
    await verifyChildHealth(server, healthUrl, config.serverPort, getLogs);
    console.log(`Production resolution smoke passed: ${healthUrl}`);
  } catch (error) {
    primaryError = error;
  } finally {
    removeSignalHandlers();
    await stopServer().catch((error) => {
      cleanupError = error;
    });
  }
  if (primaryError && cleanupError) {
    throw new AggregateError([primaryError, cleanupError], 'Smoke failed and server cleanup also failed');
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    if (process.exitCode === undefined) process.exitCode = 1;
  });
}
