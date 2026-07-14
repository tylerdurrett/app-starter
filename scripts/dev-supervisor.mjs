#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createServer, createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const LOCK_STALE_MS = 2_000;
const LOCK_HEARTBEAT_MS = 250;
const LOCK_RECLAIM_CONFIRM_MS = 300;
const GROUP_EXIT_POLL_MS = 10;
const CONTROL_PROTOCOL_VERSION = 1;
const IDENTITY_ENVIRONMENT_KEYS = [
  'APP_STARTER_CHECKOUT_ROOT',
  'APP_STARTER_RUNTIME_ROOT',
  'APP_STARTER_DEV_RUNTIME_ROOT',
  'APP_STARTER_DEV_RUNTIME_DIR',
];

function ignoreMissing(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function sanitizedChildEnvironment(env) {
  const sanitized = { ...env };
  for (const key of IDENTITY_ENVIRONMENT_KEYS) delete sanitized[key];
  return sanitized;
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
    lockDirectory: join(controlDirectory, 'owner.lock'),
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

function sameFile(path, identity) {
  if (!identity) return false;
  try {
    const stat = lstatSync(path);
    const linkTarget = stat.isSymbolicLink() ? readlinkSync(path) : null;
    return (
      stat.dev === identity.dev &&
      stat.ino === identity.ino &&
      stat.mode === identity.mode &&
      stat.ctimeMs === identity.ctimeMs &&
      linkTarget === identity.linkTarget
    );
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function fileIdentity(path) {
  const stat = lstatSync(path);
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    ctimeMs: stat.ctimeMs,
    linkTarget: stat.isSymbolicLink() ? readlinkSync(path) : null,
  };
}

function existingFileIdentity(path) {
  try {
    return fileIdentity(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function socketLinkOwned(paths, ownedSocketPath) {
  try {
    return (
      lstatSync(paths.socketPath).isSymbolicLink() &&
      readlinkSync(paths.socketPath) === ownedSocketPath
    );
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EINVAL') return false;
    throw error;
  }
}

function ownedSocketPath(paths, owner) {
  const ownerHash = createHash('sha256').update(owner).digest('hex').slice(0, 12);
  const candidate = join(paths.controlDirectory, `socket-${ownerHash}.sock`);
  if (Buffer.byteLength(candidate) < MAX_UNIX_SOCKET_PATH_BYTES) return candidate;
  const addressHash = createHash('sha256').update(paths.socketPath).digest('hex').slice(0, 10);
  return join(
    CONTROL_ROOT,
    `as-own-${paths.checkoutHash}-${addressHash}-${ownerHash.slice(0, 8)}.sock`,
  );
}

function validLockOwner(paths, owner) {
  return (
    typeof owner === 'string' &&
    owner.startsWith(`${paths.checkoutHash}.`) &&
    TOKEN_PATTERN.test(owner.slice(paths.checkoutHash.length + 1))
  );
}

function readLockOwner(paths) {
  try {
    return readFileSync(join(paths.lockDirectory, 'owner'), 'utf8').trim();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function lockSnapshot(lockDirectory) {
  try {
    const stat = statSync(lockDirectory);
    let privateSocket = null;
    try {
      privateSocket = readFileSync(join(lockDirectory, 'socket'), 'utf8').trim() || null;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return {
      owner: readFileSync(join(lockDirectory, 'owner'), 'utf8').trim(),
      mtimeMs: stat.mtimeMs,
      privateSocket,
    };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function sameLockSnapshot(first, second) {
  return (
    first?.owner === second?.owner &&
    first?.mtimeMs === second?.mtimeMs &&
    first?.privateSocket === second?.privateSocket
  );
}

function lockIsStale(snapshot, now = Date.now()) {
  return snapshot !== null && now - snapshot.mtimeMs >= LOCK_STALE_MS;
}

function tryAcquireControlLock(paths) {
  ensureControlDirectory(paths);
  const owner = `${paths.checkoutHash}.${randomBytes(TOKEN_BYTES).toString('hex')}`;
  let directoryCreated = false;
  try {
    mkdirSync(paths.lockDirectory, { mode: 0o700 });
    directoryCreated = true;
    writeFileSync(join(paths.lockDirectory, 'owner'), `${owner}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (!directoryCreated && error.code === 'EEXIST') return null;
    if (directoryCreated) rmSync(paths.lockDirectory, { recursive: true, force: true });
    throw error;
  }

  const ownsLock = () => readLockOwner(paths) === owner;
  return {
    owner,
    ownsLock,
    refresh() {
      if (!ownsLock()) throw new Error('Checkout control ownership was lost.');
      const now = new Date();
      utimesSync(paths.lockDirectory, now, now);
    },
    release() {
      if (!ownsLock()) return;
      // Refreshing prevents a stale-lock reclaimer racing this short removal.
      const now = new Date();
      utimesSync(paths.lockDirectory, now, now);
      rmSync(paths.lockDirectory, { recursive: true });
    },
  };
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function queryPrivateControl(paths, snapshot, command, options) {
  if (
    !snapshot?.privateSocket ||
    !validLockOwner(paths, snapshot.owner) ||
    snapshot.privateSocket !== ownedSocketPath(paths, snapshot.owner)
  ) {
    return null;
  }
  return queryControl({ ...paths, socketPath: snapshot.privateSocket }, command, options);
}

async function reclaimStaleControlLock(paths, command, options) {
  const first = lockSnapshot(paths.lockDirectory);
  if (!lockIsStale(first)) return false;
  const firstPrivateControl = await queryPrivateControl(paths, first, command, options);
  if (firstPrivateControl?.listener) return false;

  await wait(LOCK_RECLAIM_CONFIRM_MS);
  const confirmed = lockSnapshot(paths.lockDirectory);
  if (!sameLockSnapshot(first, confirmed) || !lockIsStale(confirmed)) return false;
  const confirmedPrivateControl = await queryPrivateControl(paths, confirmed, command, options);
  if (confirmedPrivateControl?.listener) return false;

  const quarantine = `${paths.lockDirectory}.stale-${randomBytes(8).toString('hex')}`;
  try {
    renameSync(paths.lockDirectory, quarantine);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }

  // A heartbeat may land after the last read but before rename. Revalidate the
  // quarantined lease and restore it when no contender has claimed the path.
  if (!sameLockSnapshot(confirmed, lockSnapshot(quarantine))) {
    try {
      renameSync(quarantine, paths.lockDirectory);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      rmSync(quarantine, { recursive: true, force: true });
    }
    return false;
  }
  rmSync(quarantine, { recursive: true, force: true });
  return true;
}

function tokensMatch(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function requestAuthenticator(token, checkoutHash, command, nonce) {
  return createHmac('sha256', token)
    .update(`request\0${CONTROL_PROTOCOL_VERSION}\0${checkoutHash}\0${command}\0${nonce}`)
    .digest('hex');
}

function responseAuthenticator(token, checkoutHash, command, nonce, status) {
  return createHmac('sha256', token)
    .update(
      `response\0${CONTROL_PROTOCOL_VERSION}\0${checkoutHash}\0${command}\0${nonce}\0${status}`,
    )
    .digest('hex');
}

function publicSocketLinkIsValid(paths) {
  let stat;
  try {
    stat = lstatSync(paths.socketPath);
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
  if (!stat.isSymbolicLink()) return true;
  const owner = readLockOwner(paths);
  return (
    validLockOwner(paths, owner) && readlinkSync(paths.socketPath) === ownedSocketPath(paths, owner)
  );
}

/**
 * Query the checkout's control address. A connected but unauthenticated socket
 * is deliberately reported as live so callers never remove another listener.
 */
export function queryControl(paths, command, { timeoutMs = CONTROL_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (!publicSocketLinkIsValid(paths)) {
      resolvePromise({
        listener: false,
        authenticated: false,
        reason: 'control socket does not belong to this checkout',
      });
      return;
    }
    const socket = createConnection(paths.socketPath);
    let connected = false;
    let settled = false;
    let response = '';
    let token = null;
    const nonce = randomBytes(16).toString('hex');

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
      try {
        token = readControlToken(paths.tokenPath);
      } catch (error) {
        finish({ listener: true, authenticated: false, reason: error.message });
        return;
      }
      const auth = token ? requestAuthenticator(token, paths.checkoutHash, command, nonce) : null;
      socket.write(
        `${JSON.stringify({
          version: CONTROL_PROTOCOL_VERSION,
          checkoutHash: paths.checkoutHash,
          command,
          nonce,
          auth,
        })}\n`,
      );
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
        const expectedAuth =
          token && typeof parsed.status === 'string'
            ? responseAuthenticator(token, paths.checkoutHash, command, nonce, parsed.status)
            : null;
        const identityMatches =
          parsed.version === CONTROL_PROTOCOL_VERSION &&
          parsed.checkoutHash === paths.checkoutHash &&
          parsed.nonce === nonce &&
          tokensMatch(parsed.auth, expectedAuth);
        finish({
          listener: true,
          authenticated: parsed.ok === true && identityMatches,
          reason:
            parsed.ok === true && !identityMatches
              ? 'control response identity mismatch'
              : parsed.error,
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
  let result = await queryControl(paths, command, options);
  if (result.listener) return result;

  let lock = tryAcquireControlLock(paths);
  if (!lock) {
    const ownerSnapshot = lockSnapshot(paths.lockDirectory);
    const privateControl = await queryPrivateControl(paths, ownerSnapshot, command, options);
    if (privateControl?.listener) return privateControl;
    if (await reclaimStaleControlLock(paths, command, options)) {
      lock = tryAcquireControlLock(paths);
    }
  }
  if (!lock) return result;
  try {
    // The second probe closes the query→unlink race: a compliant startup must
    // own this same lock before it can bind the socket.
    const tokenIdentity = existingFileIdentity(paths.tokenPath);
    const socketIdentity = existingFileIdentity(paths.socketPath);
    result = await queryControl(paths, command, options);
    if (!result.listener) {
      if (sameFile(paths.tokenPath, tokenIdentity)) ignoreMissing(paths.tokenPath);
      if (sameFile(paths.socketPath, socketIdentity)) ignoreMissing(paths.socketPath);
    }
    return result;
  } finally {
    lock.release();
  }
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
  const lock = tryAcquireControlLock(paths);
  if (!lock) {
    const control = await inspectControl(paths);
    assertNoActiveSupervisor(control);
    throw new Error('Development services are already starting for this checkout.');
  }
  // This lock excludes both other starts and preflight stale cleanup.
  const existingTokenIdentity = existingFileIdentity(paths.tokenPath);
  const existingSocketIdentity = existingFileIdentity(paths.socketPath);
  try {
    const existingControl = await queryControl(paths, 'status');
    assertNoActiveSupervisor(existingControl);
  } catch (error) {
    lock.release();
    throw error;
  }
  if (sameFile(paths.tokenPath, existingTokenIdentity)) ignoreMissing(paths.tokenPath);
  if (sameFile(paths.socketPath, existingSocketIdentity)) ignoreMissing(paths.socketPath);
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const ownedSocket = ownedSocketPath(paths, lock.owner);
  const connections = new Set();
  let socketOwned = false;
  let tokenPublished = false;
  let tokenIdentity;
  let heartbeat;
  const successResponse = (command, nonce, status) => ({
    ok: true,
    version: CONTROL_PROTOCOL_VERSION,
    checkoutHash: paths.checkoutHash,
    nonce,
    status,
    auth: responseAuthenticator(token, paths.checkoutHash, command, nonce, status),
  });
  const server = createServer((socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
    let request = '';
    socket.on('data', (chunk) => {
      try {
        request += chunk;
        if (request.length > MAX_REQUEST_BYTES) {
          socket.removeAllListeners('data');
          socket.end(`${JSON.stringify({ ok: false, error: 'request too large' })}\n`);
          return;
        }
        const newline = request.indexOf('\n');
        if (newline === -1) return;
        socket.removeAllListeners('data');

        const parsed = JSON.parse(request.slice(0, newline));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('invalid request');
        }
        const validEnvelope =
          parsed.version === CONTROL_PROTOCOL_VERSION &&
          parsed.checkoutHash === paths.checkoutHash &&
          (parsed.command === 'status' || parsed.command === 'stop') &&
          typeof parsed.nonce === 'string' &&
          /^[a-f0-9]{32}$/.test(parsed.nonce);
        const expectedAuth = validEnvelope
          ? requestAuthenticator(token, paths.checkoutHash, parsed.command, parsed.nonce)
          : null;
        if (!validEnvelope || !tokensMatch(parsed.auth, expectedAuth)) {
          socket.end(`${JSON.stringify({ ok: false, error: 'authentication failed' })}\n`);
          return;
        }
        if (parsed.command === 'status') {
          socket.end(`${JSON.stringify(successResponse('status', parsed.nonce, 'running'))}\n`);
          return;
        }
        if (parsed.command === 'stop') {
          socket.end(
            `${JSON.stringify(successResponse('stop', parsed.nonce, 'stopping'))}\n`,
            () => {
              try {
                onStop();
              } catch (error) {
                console.error(error);
              }
            },
          );
          return;
        }
      } catch {
        if (!socket.destroyed) {
          socket.end(`${JSON.stringify({ ok: false, error: 'invalid request' })}\n`);
        }
      }
    });
  });

  try {
    if (!lock.ownsLock()) throw new Error('Checkout control ownership was lost.');
    await listen(server, ownedSocket);
    socketOwned = true;
    chmodSync(ownedSocket, 0o600);
    writeFileSync(join(paths.lockDirectory, 'socket'), `${ownedSocket}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    lock.refresh();
    symlinkSync(ownedSocket, paths.socketPath);
    if (!lock.ownsLock()) throw new Error('Checkout control ownership was lost.');
    writeControlToken(paths.tokenPath, token);
    tokenPublished = true;
    tokenIdentity = fileIdentity(paths.tokenPath);
    lock.refresh();
    heartbeat = setInterval(() => {
      try {
        lock.refresh();
      } catch (error) {
        clearInterval(heartbeat);
        console.error(`Development supervisor lost its control lease: ${error.message}`);
        try {
          onStop();
        } catch (stopError) {
          console.error(stopError);
        }
      }
    }, LOCK_HEARTBEAT_MS);
    heartbeat.unref?.();
  } catch (error) {
    clearInterval(heartbeat);
    const ownsLock = lock.ownsLock();
    if (socketOwned) {
      await new Promise((resolvePromise) => server.close(() => resolvePromise()));
      if (ownsLock && socketLinkOwned(paths, ownedSocket)) ignoreMissing(paths.socketPath);
      ignoreMissing(ownedSocket);
    }
    // Never unlink state we did not publish: it may belong to a live listener
    // that won the control-address race.
    if (ownsLock && tokenPublished && sameFile(paths.tokenPath, tokenIdentity)) {
      ignoreMissing(paths.tokenPath);
    }
    if (ownsLock) lock.release();
    throw error;
  }

  let closed = false;
  return {
    server,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      const ownsLock = lock.ownsLock();
      if (ownsLock) lock.refresh();
      for (const socket of connections) socket.destroy();
      await new Promise((resolvePromise) => server.close(() => resolvePromise()));
      if (ownsLock && sameFile(paths.tokenPath, tokenIdentity)) ignoreMissing(paths.tokenPath);
      if (ownsLock && socketLinkOwned(paths, ownedSocket)) ignoreMissing(paths.socketPath);
      ignoreMissing(ownedSocket);
      if (ownsLock) lock.release();
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

function processGroupExists(child, killProcess = process.kill) {
  if (!child?.pid) return false;
  try {
    killProcess(-child.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
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
    groupExists = (ownedChild) => processGroupExists(ownedChild, killProcess),
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
  let groupPollTimer;
  let shutdownStarted = false;
  let shutdownForwarded = false;
  let shutdownSignal = 'SIGTERM';
  let killDelivered = false;
  let childResult;
  let settleRun;
  let failRun;

  const clearGroupTimers = () => {
    clearTimeout(escalationTimer);
    clearTimeout(groupPollTimer);
  };

  const finishWhenGroupExits = (deadline) => {
    let alive;
    try {
      alive = groupExists(child);
    } catch (error) {
      // macOS can report EPERM for a just-killed orphaned group while its
      // unsignalable zombie is being reaped. A successful group SIGKILL has
      // already ended every process the supervisor can own in that case.
      if (killDelivered && error.code === 'EPERM') alive = false;
      else {
        failRun?.(error);
        return;
      }
    }
    if (!alive) {
      if (childResult) {
        clearGroupTimers();
        settleRun?.(childResult);
        return;
      }
    }
    if (Date.now() >= deadline) {
      failRun?.(
        new Error(
          alive
            ? 'Owned development process group survived SIGKILL.'
            : 'Owned development process did not report its exit after SIGKILL.',
        ),
      );
      return;
    }
    groupPollTimer = setTimeout(() => finishWhenGroupExits(deadline), GROUP_EXIT_POLL_MS);
  };

  const escalate = () => {
    try {
      if (groupExists(child)) {
        signalProcessGroup(child, 'SIGKILL', killProcess);
        killDelivered = true;
      }
      finishWhenGroupExits(Date.now() + terminationGraceMs);
    } catch (error) {
      failRun?.(error);
    }
  };

  const forwardShutdown = () => {
    if (shutdownForwarded || !child) return;
    shutdownForwarded = true;
    try {
      signalProcessGroup(child, shutdownSignal, killProcess);
      escalationTimer = setTimeout(escalate, terminationGraceMs);
    } catch (error) {
      failRun?.(error);
    }
  };

  const beginShutdown = (signal = 'SIGTERM') => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    shutdownSignal = signal;
    forwardShutdown();
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
      env: sanitizedChildEnvironment(env),
      stdio,
      detached: true,
    });

    return await new Promise((resolvePromise, reject) => {
      let settled = false;
      settleRun = (result) => {
        if (settled) return;
        settled = true;
        resolvePromise(result);
      };
      failRun = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      child.once('error', (error) => {
        failRun(error);
      });
      child.once('close', (code, signal) => {
        if (settled) return;
        childResult = { code, signal };
        if (!shutdownStarted) beginShutdown('SIGTERM');
        try {
          if (!groupExists(child)) {
            clearGroupTimers();
            settleRun(childResult);
          }
        } catch (error) {
          failRun(error);
        }
      });
      if (shutdownStarted) forwardShutdown();
    });
  } finally {
    clearGroupTimers();
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
  return { ok: true, status: result.response.status };
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
  // Checkout identity is code location, never inherited process state. This is
  // what prevents a command launched in checkout B from controlling checkout A.
  const checkoutRoot = scriptRoot;
  const runtimeRoot = CONTROL_ROOT;

  if (cli.subcommand === 'preflight') await preflight({ checkoutRoot, runtimeRoot });
  else if (cli.subcommand === 'stop') await stopSupervised({ checkoutRoot, runtimeRoot });
  else {
    const result = await startSupervised(cli.command, cli.args, { checkoutRoot, runtimeRoot });
    const signalExitCodes = { SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };
    process.exitCode = result.code ?? signalExitCodes[result.signal] ?? 1;
  }
}

const isMainModule =
  process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);

if (isMainModule) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
