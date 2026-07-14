#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { canonicalCheckoutRoot } from './compose.mjs';
import { isPortAvailable } from './port-availability.mjs';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTROL_ROOT = '/tmp';
const CONTROL_TIMEOUT_MS = 1_000;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const MAX_REQUEST_BYTES = 4_096;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;
const MAX_UNIX_SOCKET_PATH_BYTES = 100;

function ignoreMissing(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/** Derive a short Unix control address from the canonical checkout path. */
export function controlPaths(checkoutRoot = scriptRoot, runtimeRoot = CONTROL_ROOT) {
  const canonicalRoot = canonicalCheckoutRoot(checkoutRoot);
  const checkoutHash = createHash('sha256').update(canonicalRoot).digest('hex').slice(0, 20);
  const controlDirectory = join(runtimeRoot, `app-starter-dev-${checkoutHash}`);
  const preferredSocketPath = join(controlDirectory, 'control.sock');
  const runtimeHash = createHash('sha256').update(resolve(runtimeRoot)).digest('hex').slice(0, 10);
  // macOS has a 104-byte sockaddr_un.sun_path; Linux permits only a few more.
  // Keep test/custom runtime roots isolated without trusting their path length.
  const socketPath =
    Buffer.byteLength(preferredSocketPath) < MAX_UNIX_SOCKET_PATH_BYTES
      ? preferredSocketPath
      : join(CONTROL_ROOT, `as-dev-${checkoutHash}-${runtimeHash}.sock`);

  return {
    canonicalRoot,
    checkoutHash,
    controlDirectory,
    socketPath,
    tokenPath: join(controlDirectory, 'token'),
  };
}

function ensureControlDirectory(paths) {
  mkdirSync(paths.controlDirectory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(paths.controlDirectory);
  if (!stat.isDirectory())
    throw new Error(`Control path is not a directory: ${paths.controlDirectory}`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`Refusing control directory owned by another user: ${paths.controlDirectory}`);
  }
  chmodSync(paths.controlDirectory, 0o700);
}

function readControlToken(tokenPath) {
  let stat;
  try {
    stat = lstatSync(tokenPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) return null;

  const token = readFileSync(tokenPath, 'utf8').trim();
  return TOKEN_PATTERN.test(token) ? token : null;
}

function writeControlToken(tokenPath, token) {
  const temporaryPath = `${tokenPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    fd = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(fd, `${token}\n`, 'utf8');
    closeSync(fd);
    fd = undefined;
    chmodSync(temporaryPath, 0o600);
    // link(2) supplies the no-replace atomic publish that rename(2) lacks.
    linkSync(temporaryPath, tokenPath);
  } finally {
    if (fd !== undefined) closeSync(fd);
    ignoreMissing(temporaryPath);
  }
}

function tokensMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

/**
 * Query the checkout's control address. A connected but unauthenticated socket
 * is deliberately reported as live so callers never remove another listener.
 */
export function queryControl(paths, command, { timeoutMs = CONTROL_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    const socket = createConnection(paths.socketPath);
    let connected = false;
    let settled = false;
    let response = '';

    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolvePromise(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      connected = true;
      let token = null;
      try {
        token = readControlToken(paths.tokenPath);
      } catch (error) {
        finish({ listener: true, authenticated: false, reason: error.message });
        return;
      }
      socket.write(`${JSON.stringify({ command, token })}\n`);
    });
    socket.on('data', (chunk) => {
      response += chunk;
      if (response.length > MAX_REQUEST_BYTES) {
        finish({ listener: true, authenticated: false, reason: 'oversized response' });
        return;
      }
      const newline = response.indexOf('\n');
      if (newline === -1) return;
      try {
        const parsed = JSON.parse(response.slice(0, newline));
        finish({
          listener: true,
          authenticated: parsed.ok === true,
          reason: parsed.error,
          response: parsed,
        });
      } catch {
        finish({ listener: true, authenticated: false, reason: 'invalid response' });
      }
    });
    socket.once('timeout', () => {
      finish({ listener: connected, authenticated: false, reason: 'control request timed out' });
    });
    socket.once('error', (error) => {
      if (
        !connected &&
        (error.code === 'ENOENT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTSOCK')
      ) {
        finish({ listener: false, authenticated: false });
        return;
      }
      if (connected && (error.code === 'ECONNRESET' || error.code === 'EPIPE')) {
        finish({ listener: true, authenticated: false, reason: 'connection closed' });
        return;
      }
      finish(undefined, error);
    });
  });
}

export async function inspectControl(paths, command = 'status', options) {
  const result = await queryControl(paths, command, options);
  if (!result.listener) {
    // Token and socket files only become stale once no process is listening.
    ignoreMissing(paths.tokenPath);
    ignoreMissing(paths.socketPath);
  }
  return result;
}

function assertNoActiveSupervisor(result) {
  if (!result.listener) return;
  if (result.authenticated)
    throw new Error('Development services are already managed by this checkout.');
  throw new Error(
    `Refusing a live checkout control socket that could not be authenticated${
      result.reason ? `: ${result.reason}` : ''
    }.`,
  );
}

export function configuredDevPorts(checkoutRoot = scriptRoot) {
  const configPath = join(canonicalCheckoutRoot(checkoutRoot), 'project.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const ports = [config.serverPort, config.webPort];
  if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new Error(`Expected valid serverPort and webPort values in ${configPath}`);
  }
  return ports;
}

export async function assertConfiguredPortsAvailable(
  checkoutRoot = scriptRoot,
  { checkPort = isPortAvailable } = {},
) {
  const occupied = [];
  for (const port of configuredDevPorts(checkoutRoot)) {
    if (!(await checkPort(port))) occupied.push(port);
  }
  if (occupied.length > 0) {
    throw new Error(
      `Refusing to start because this checkout's configured port${occupied.length === 1 ? '' : 's'} ${occupied.join(
        ', ',
      )} ${occupied.length === 1 ? 'is' : 'are'} already in use.`,
    );
  }
}

/** Gate both the early database sequence and the final supervised spawn. */
export async function preflight({
  checkoutRoot = scriptRoot,
  runtimeRoot = CONTROL_ROOT,
  checkPort,
} = {}) {
  const paths = controlPaths(checkoutRoot, runtimeRoot);
  const control = await inspectControl(paths);
  assertNoActiveSupervisor(control);
  await assertConfiguredPortsAvailable(paths.canonicalRoot, { checkPort });
  return paths;
}

function listen(server, socketPath) {
  return new Promise((resolvePromise, reject) => {
    const previousUmask = process.umask(0o077);
    try {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        resolvePromise();
      });
    } finally {
      process.umask(previousUmask);
    }
  });
}

export async function createControlChannel(paths, onStop) {
  ensureControlDirectory(paths);
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const connections = new Set();
  let socketOwned = false;
  let tokenPublished = false;
  const server = createServer((socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
    let request = '';
    socket.on('data', (chunk) => {
      request += chunk;
      if (request.length > MAX_REQUEST_BYTES) {
        socket.end(`${JSON.stringify({ ok: false, error: 'request too large' })}\n`);
        return;
      }
      const newline = request.indexOf('\n');
      if (newline === -1) return;
      socket.removeAllListeners('data');

      let parsed;
      try {
        parsed = JSON.parse(request.slice(0, newline));
      } catch {
        socket.end(`${JSON.stringify({ ok: false, error: 'invalid request' })}\n`);
        return;
      }
      if (!tokensMatch(parsed.token, token)) {
        socket.end(`${JSON.stringify({ ok: false, error: 'authentication failed' })}\n`);
        return;
      }
      if (parsed.command === 'status') {
        socket.end(`${JSON.stringify({ ok: true, status: 'running' })}\n`);
        return;
      }
      if (parsed.command === 'stop') {
        socket.end(`${JSON.stringify({ ok: true, status: 'stopping' })}\n`, () => onStop());
        return;
      }
      socket.end(`${JSON.stringify({ ok: false, error: 'unknown command' })}\n`);
    });
  });

  try {
    await listen(server, paths.socketPath);
    socketOwned = true;
    chmodSync(paths.socketPath, 0o600);
    writeControlToken(paths.tokenPath, token);
    tokenPublished = true;
  } catch (error) {
    if (socketOwned) {
      await new Promise((resolvePromise) => server.close(() => resolvePromise()));
      ignoreMissing(paths.socketPath);
    }
    // Never unlink state we did not publish: it may belong to a live listener
    // that won the control-address race.
    if (tokenPublished) ignoreMissing(paths.tokenPath);
    throw error;
  }

  let closed = false;
  return {
    server,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of connections) socket.destroy();
      await new Promise((resolvePromise) => server.close(() => resolvePromise()));
      ignoreMissing(paths.tokenPath);
      ignoreMissing(paths.socketPath);
    },
  };
}

function signalProcessGroup(child, signal, killProcess = process.kill) {
  if (!child?.pid) return;
  try {
    killProcess(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

/** Start and exclusively supervise one detached child process group. */
export async function startSupervised(
  command,
  args = [],
  {
    checkoutRoot = scriptRoot,
    runtimeRoot = CONTROL_ROOT,
    checkPort,
    spawnCommand = spawn,
    killProcess = process.kill,
    terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
    env = process.env,
    stdio = 'inherit',
    installSignalHandlers = true,
  } = {},
) {
  if (!command) throw new Error('start requires a command after --');

  // This intentionally repeats the standalone preflight immediately before
  // spawning Turbo, closing the window occupied by database setup/migrations.
  const paths = await preflight({ checkoutRoot, runtimeRoot, checkPort });
  let child;
  let escalationTimer;
  let shutdownStarted = false;

  const beginShutdown = (signal = 'SIGTERM') => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    signalProcessGroup(child, signal, killProcess);
    escalationTimer = setTimeout(
      () => signalProcessGroup(child, 'SIGKILL', killProcess),
      terminationGraceMs,
    );
    escalationTimer.unref?.();
  };

  const channel = await createControlChannel(paths, () => beginShutdown('SIGTERM'));
  const onSigint = () => beginShutdown('SIGINT');
  const onSigterm = () => beginShutdown('SIGTERM');
  if (installSignalHandlers) {
    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);
  }

  try {
    child = spawnCommand(command, args, {
      cwd: paths.canonicalRoot,
      env,
      stdio,
      detached: true,
    });

    return await new Promise((resolvePromise, reject) => {
      let settled = false;
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      child.once('close', (code, signal) => {
        if (settled) return;
        settled = true;
        resolvePromise({ code, signal });
      });
    });
  } finally {
    clearTimeout(escalationTimer);
    if (installSignalHandlers) {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    }
    await channel.close();
  }
}

export async function stopSupervised({
  checkoutRoot = scriptRoot,
  runtimeRoot = CONTROL_ROOT,
} = {}) {
  const paths = controlPaths(checkoutRoot, runtimeRoot);
  const result = await inspectControl(paths, 'stop');
  if (!result.listener)
    throw new Error('No managed development services are running for this checkout.');
  if (!result.authenticated) {
    throw new Error(
      `Refusing a live checkout control socket that could not be authenticated${
        result.reason ? `: ${result.reason}` : ''
      }.`,
    );
  }
  return result.response;
}

function parseCli(argv) {
  const [subcommand, separator, ...command] = argv;
  if (subcommand === 'start' && separator === '--' && command.length > 0) {
    return { subcommand, command: command[0], args: command.slice(1) };
  }
  if ((subcommand === 'preflight' || subcommand === 'stop') && separator === undefined) {
    return { subcommand };
  }
  throw new Error('Usage: dev-supervisor.mjs preflight | start -- <command> [args...] | stop');
}

export async function main(argv = process.argv.slice(2)) {
  const cli = parseCli(argv);
  const checkoutRoot = process.env.APP_STARTER_CHECKOUT_ROOT || scriptRoot;
  const runtimeRoot = process.env.APP_STARTER_DEV_RUNTIME_ROOT || CONTROL_ROOT;

  if (cli.subcommand === 'preflight') await preflight({ checkoutRoot, runtimeRoot });
  else if (cli.subcommand === 'stop') await stopSupervised({ checkoutRoot, runtimeRoot });
  else {
    const result = await startSupervised(cli.command, cli.args, { checkoutRoot, runtimeRoot });
    const signalExitCodes = { SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };
    process.exitCode = result.code ?? signalExitCodes[result.signal] ?? 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
