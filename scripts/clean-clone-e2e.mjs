#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { composeProjectName } from './compose.mjs';
import { isPortAvailable } from './port-availability.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const ROGUE_PORTS = [5100, 5150, 5200];
const POSTGRES_IMAGE = 'postgres:16-alpine';
const COMMAND_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 300_000;
const START_TIMEOUT_MS = 180_000;
const STOP_TIMEOUT_MS = 30_000;
const OUTPUT_TAIL_BYTES = 120_000;
const MARKER_RELATION = 'clean_clone_e2e_marker';
const MARKER_VALUE = 'belongs-only-to-clone-a';

function quoteArgument(value) {
  return /^[a-zA-Z0-9_./:=@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function commandText(command, args) {
  return [command, ...args].map(quoteArgument).join(' ');
}

function outputTail(value, limit = OUTPUT_TAIL_BYTES) {
  return value.length <= limit
    ? value
    : `[... ${value.length - limit} bytes omitted ...]\n${value.slice(-limit)}`;
}

function createCapture() {
  let value = '';
  return {
    append(chunk) {
      value += chunk;
      if (value.length > OUTPUT_TAIL_BYTES * 2) value = value.slice(-OUTPUT_TAIL_BYTES);
    },
    get value() {
      return value;
    },
  };
}

function labelStream(stream, label, destination, capture, echo = true) {
  let pending = '';
  stream?.setEncoding('utf8');
  stream?.on('data', (chunk) => {
    capture.append(chunk);
    if (!echo) return;
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) destination.write(`[${label}] ${line}\n`);
  });
  stream?.on('end', () => {
    if (echo && pending) destination.write(`[${label}] ${pending}\n`);
  });
}

function signalOwnedGroup(child, signal) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

export function waitForChildExit(childRun, timeoutMs) {
  if (childRun.result) return Promise.resolve(childRun.result);
  return new Promise((resolvePromise) => {
    const onClose = () => finish(childRun.result);
    const timer = setTimeout(() => finish(null), timeoutMs);
    const finish = (result) => {
      clearTimeout(timer);
      childRun.child.off('close', onClose);
      resolvePromise(result);
    };
    childRun.child.once('close', onClose);
  });
}

async function terminateOwnedChild(childRun, timeoutMs = 5_000) {
  if (await waitForChildExit(childRun, 0)) return;
  signalOwnedGroup(childRun.child, 'SIGTERM');
  if (await waitForChildExit(childRun, timeoutMs)) return;
  signalOwnedGroup(childRun.child, 'SIGKILL');
  if (!(await waitForChildExit(childRun, timeoutMs))) {
    throw new Error(`Owned process group ${childRun.child.pid} survived SIGKILL.`);
  }
}

function startLogged(command, args, { cwd, env, label, echo = true }) {
  process.stdout.write(`[${label}] $ ${commandText(command, args)}\n`);
  const child = spawn(command, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = createCapture();
  const stderr = createCapture();
  const childRun = { child, stdout, stderr, result: null, spawnError: null };
  labelStream(child.stdout, `${label}:stdout`, process.stdout, stdout, echo);
  labelStream(child.stderr, `${label}:stderr`, process.stderr, stderr, echo);
  child.once('error', (error) => {
    childRun.spawnError = error;
  });
  child.once('close', (code, signal) => {
    childRun.result = { code, signal };
  });
  return childRun;
}

export async function runBounded(
  command,
  args,
  {
    cwd = repoRoot,
    env = process.env,
    label = 'command',
    timeoutMs = COMMAND_TIMEOUT_MS,
    echo = true,
  } = {},
) {
  const childRun = startLogged(command, args, { cwd, env, label, echo });
  const result = await waitForChildExit(childRun, timeoutMs);
  if (!result) {
    const timeoutError = new Error(
      `${label} timed out after ${timeoutMs}ms: ${commandText(command, args)}\n` +
        formatChildDiagnostics(childRun),
    );
    try {
      await terminateOwnedChild(childRun);
    } catch (terminationError) {
      throw new AggregateError(
        [timeoutError, terminationError],
        `${label} timed out and its owned process group could not be stopped.`,
      );
    }
    throw timeoutError;
  }
  if (childRun.spawnError) throw childRun.spawnError;
  if (result.code !== 0) {
    throw new Error(
      `${label} exited with ${result.signal ?? `code ${result.code}`}: ${commandText(command, args)}\n` +
        formatChildDiagnostics(childRun),
    );
  }
  return { stdout: childRun.stdout.value, stderr: childRun.stderr.value };
}

async function settleAll(promises, label) {
  const results = await Promise.allSettled(promises);
  const errors = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, `${label} had multiple failures.`);
  return results.map((result) => result.value);
}

function formatChildDiagnostics(childRun) {
  const stdout = outputTail(childRun.stdout.value.trim());
  const stderr = outputTail(childRun.stderr.value.trim());
  return [stdout && `stdout:\n${stdout}`, stderr && `stderr:\n${stderr}`]
    .filter(Boolean)
    .join('\n');
}

export function readConfigSource(source, label = 'project.config.json') {
  const config = JSON.parse(source);
  for (const key of ['serverPort', 'dbPort', 'webPort']) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > 65_535) {
      throw new Error(`${label}: ${key} must be an integer between 1 and 65535.`);
    }
  }
  return config;
}

function cleanChildEnvironment(inherited = process.env) {
  const env = { ...inherited, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const key of [
    'APP_STARTER_CHECKOUT_ROOT',
    'APP_STARTER_DEV_RUNTIME_ROOT',
    'COMPOSE_PROJECT_NAME',
    'DATABASE_MODE',
    'DATABASE_URL',
    'DB_PORT',
    'PORT',
    'SERVER_PORT',
    'WEB_PORT',
  ]) {
    delete env[key];
  }
  return env;
}

async function assertCandidatesAvailable() {
  for (const port of ROGUE_PORTS) {
    if (!(await isPortAvailable(port))) {
      throw new Error(
        `Candidate port ${port} is already occupied. Refusing to disturb the existing listener; free it and retry.`,
      );
    }
  }
}

async function assertDockerAvailable(env) {
  await runBounded('docker', ['info', '--format', '{{.ServerVersion}}'], {
    env,
    label: 'preflight:docker',
    timeoutMs: 20_000,
  });
  await runBounded('docker', ['compose', 'version'], {
    env,
    label: 'preflight:compose',
    timeoutMs: 20_000,
  });
  await runBounded('docker', ['pull', POSTGRES_IMAGE], {
    env,
    label: 'preflight:image',
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
}

async function inspectContainer(container, env, label, echo = false) {
  const result = await runBounded('docker', ['inspect', container], {
    env,
    label,
    timeoutMs: 20_000,
    echo,
  });
  const inspections = JSON.parse(result.stdout);
  assert.equal(inspections.length, 1, `${label}: Docker must return one inspection.`);
  return inspections[0];
}

function expectedRogueMappings() {
  return ROGUE_PORTS.map((port) => `127.0.0.1:${port}`).sort();
}

export function assertRunningRogue(inspection, rogue) {
  assert.equal(inspection.Id, rogue.containerId, 'Rogue container identity changed.');
  assert.equal(
    String(inspection.Name).replace(/^\//, ''),
    rogue.name,
    'Rogue container name changed.',
  );
  assert.equal(
    inspection.Config?.Labels?.['app-starter.clean-clone-e2e'],
    rogue.runId,
    'Rogue container ownership label changed.',
  );
  assert.equal(inspection.State?.Running, true, 'Rogue Postgres must still be running.');
  assert.equal(inspection.State?.Status, 'running', 'Rogue Postgres must still be running.');
  const publishedPorts = inspection.HostConfig?.PortBindings?.['5432/tcp'] ?? [];
  assert.deepEqual(
    publishedPorts.map(({ HostIp, HostPort }) => `${HostIp}:${HostPort}`).sort(),
    expectedRogueMappings(),
    'Rogue Postgres must still own every first candidate port on IPv4 loopback.',
  );
}

async function startRoguePostgres(rogue, env) {
  const args = [
    'run',
    '--detach',
    '--name',
    rogue.name,
    '--label',
    `app-starter.clean-clone-e2e=${rogue.runId}`,
    '-e',
    'POSTGRES_PASSWORD=postgres',
    ...ROGUE_PORTS.flatMap((port) => ['-p', `127.0.0.1:${port}:5432`]),
    POSTGRES_IMAGE,
    'postgres',
    '-c',
    'log_statement=all',
    '-c',
    'log_connections=on',
  ];
  rogue.creationAttempted = true;
  const result = await runBounded('docker', args, {
    env,
    label: 'rogue:start',
    timeoutMs: 120_000,
  });
  rogue.containerId = result.stdout.trim();
  assert.match(rogue.containerId, /^[a-f0-9]{12,64}$/);
  const inspection = await inspectContainer(rogue.containerId, env, 'rogue:inspect');
  assertRunningRogue(inspection, rogue);

  await waitUntil('rogue Postgres readiness log', 60_000, async () => {
    const logs = await readRogueLogs(rogue, env, false);
    const readyCount = (
      logs.combined.match(/database system is ready to accept connections/g) ?? []
    ).length;
    return readyCount >= 2 &&
      /PostgreSQL init process complete; ready for start up/.test(logs.combined)
      ? logs
      : null;
  });
  rogue.baseline = await readRogueLogs(rogue, env, true);
  process.stdout.write(
    `[rogue] readiness observed through Docker logs; baseline captured without a database connection.\n`,
  );
}

async function readRogueLogs(rogue, env, echo) {
  const result = await runBounded(
    'docker',
    ['logs', '--timestamps', rogue.containerId ?? rogue.name],
    {
      env,
      label: 'rogue:logs',
      timeoutMs: 20_000,
      echo,
    },
  );
  return { ...result, combined: `${result.stdout}${result.stderr}` };
}

export function logSuffix(baseline, current) {
  if (typeof baseline === 'object' && typeof current === 'object') {
    return `${logSuffix(baseline.stdout, current.stdout)}${logSuffix(baseline.stderr, current.stderr)}`;
  }
  if (!current.startsWith(baseline)) {
    throw new Error(
      'Rogue Docker logs changed before their captured baseline; cannot prove silence.',
    );
  }
  return current.slice(baseline.length);
}

export function analyzeRogueLogSuffix(suffix) {
  const connectionCount = (suffix.match(/connection received:/g) ?? []).length;
  const statementCount = (suffix.match(/\bstatement:/g) ?? []).length;
  const applicationTableCount = (
    suffix.match(
      /\b(?:accounts|integrations|jwks|oauth_(?:access_tokens|clients|consents|refresh_tokens)|project_(?:invites|memberships)|projects|sessions|users|verifications|workspace_(?:invites|memberships)|workspaces)\b/g,
    ) ?? []
  ).length;
  return { connectionCount, statementCount, applicationTableCount };
}

export function assertRogueSilent(baseline, current) {
  const suffix = logSuffix(baseline, current);
  const counts = analyzeRogueLogSuffix(suffix);
  assert.deepEqual(counts, {
    connectionCount: 0,
    statementCount: 0,
    applicationTableCount: 0,
  });
  return { suffix, ...counts };
}

export function assertRogueProof(rogue, inspection, baseline, current) {
  assertRunningRogue(inspection, rogue);
  return assertRogueSilent(baseline, current);
}

async function createClone(sourceRoot, commit, destination, label, env) {
  await runBounded(
    'git',
    ['clone', '--quiet', '--no-checkout', '--no-hardlinks', sourceRoot, destination],
    { env, label: `${label}:clone`, timeoutMs: COMMAND_TIMEOUT_MS },
  );
  await runBounded('git', ['checkout', '--quiet', '--detach', commit], {
    cwd: destination,
    env,
    label: `${label}:checkout`,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  await Promise.all([
    readFile(join(destination, 'project.config.json')).then(
      () => Promise.reject(new Error(`${label} clone unexpectedly contains project.config.json.`)),
      (error) => {
        if (error.code !== 'ENOENT') throw error;
      },
    ),
    readFile(join(destination, '.env')).then(
      () => Promise.reject(new Error(`${label} clone unexpectedly contains .env.`)),
      (error) => {
        if (error.code !== 'ENOENT') throw error;
      },
    ),
  ]);
  const root = await realpath(destination);
  return {
    label,
    root,
    env: { ...env },
    config: null,
    go: null,
    compose: null,
    stopped: false,
    cleanup: {
      project: composeProjectName(root),
      prestateEmpty: false,
      goAttempted: false,
      owned: null,
    },
  };
}

function outputLines(value) {
  return value.trim().split(/\s+/).filter(Boolean).sort();
}

async function projectResourceReferences(checkout, label = checkout.label) {
  const filter = `label=com.docker.compose.project=${checkout.cleanup.project}`;
  const options = {
    env: checkout.env,
    timeoutMs: 20_000,
    echo: false,
  };
  const [containers, volumes, networks] = await settleAll(
    [
      runBounded('docker', ['ps', '--all', '--quiet', '--filter', filter], {
        ...options,
        label: `${label}:project-containers`,
      }),
      runBounded('docker', ['volume', 'ls', '--quiet', '--filter', filter], {
        ...options,
        label: `${label}:project-volumes`,
      }),
      runBounded('docker', ['network', 'ls', '--quiet', '--filter', filter], {
        ...options,
        label: `${label}:project-networks`,
      }),
    ],
    `${label} Compose resource query`,
  );
  return {
    containers: outputLines(containers.stdout),
    volumes: outputLines(volumes.stdout),
    networks: outputLines(networks.stdout),
  };
}

function resourceReferenceCount(resources) {
  return resources.containers.length + resources.volumes.length + resources.networks.length;
}

export function assertEmptyComposePrestate(resources, project) {
  assert.equal(
    resourceReferenceCount(resources),
    0,
    `Refusing checkout project ${project}: Compose resources already exist (${JSON.stringify(resources)}).`,
  );
}

async function prepareComposeCleanup(checkout) {
  const resources = await projectResourceReferences(checkout, `${checkout.label}:prestate`);
  assertEmptyComposePrestate(resources, checkout.cleanup.project);
  checkout.cleanup.prestateEmpty = true;
  process.stdout.write(
    `[${checkout.label}] Compose project ${checkout.cleanup.project} has an empty prestate.\n`,
  );
}

async function inspectResourceGroup(kind, references, checkout, label) {
  if (references.length === 0) return [];
  const prefix = kind === 'container' ? [] : [kind];
  const result = await runBounded('docker', [...prefix, 'inspect', ...references], {
    env: checkout.env,
    label,
    timeoutMs: 20_000,
    echo: false,
  });
  const inspections = JSON.parse(result.stdout);
  assert.equal(inspections.length, references.length, `${label}: inspection count changed.`);
  return inspections;
}

async function inspectProjectResources(checkout) {
  const references = await projectResourceReferences(
    checkout,
    `${checkout.label}:cleanup-snapshot`,
  );
  const [containers, volumes, networks] = await settleAll(
    [
      inspectResourceGroup(
        'container',
        references.containers,
        checkout,
        `${checkout.label}:cleanup-containers`,
      ),
      inspectResourceGroup(
        'volume',
        references.volumes,
        checkout,
        `${checkout.label}:cleanup-volumes`,
      ),
      inspectResourceGroup(
        'network',
        references.networks,
        checkout,
        `${checkout.label}:cleanup-networks`,
      ),
    ],
    `${checkout.label} Compose ownership inspection`,
  );
  return { references, containers, volumes, networks };
}

export function composeCleanupEligible(checkout) {
  return Boolean(
    checkout.cleanup?.prestateEmpty &&
    (checkout.cleanup.goAttempted || checkout.cleanup.owned !== null),
  );
}

export function assertComposeCleanupOwnership(checkout, resources) {
  assert.equal(
    composeCleanupEligible(checkout),
    true,
    `Refusing Compose cleanup for ${checkout.label}: no empty prestate and owned go attempt.`,
  );
  const project = checkout.cleanup.project;
  for (const resource of [...resources.containers, ...resources.volumes, ...resources.networks]) {
    assert.equal(
      resource.Labels?.['com.docker.compose.project'] ??
        resource.Config?.Labels?.['com.docker.compose.project'],
      project,
      `Refusing Compose cleanup for ${checkout.label}: resource ownership label changed.`,
    );
  }
  for (const container of resources.containers) {
    assert.equal(
      container.Config?.Labels?.['com.docker.compose.project.working_dir'],
      checkout.root,
      `Refusing Compose cleanup for ${checkout.label}: container working directory changed.`,
    );
  }

  const owned = checkout.cleanup.owned;
  if (owned) {
    assert.equal(
      resources.containers.some((container) => container.Id === owned.containerId),
      true,
      `Refusing Compose cleanup for ${checkout.label}: owned container identity changed.`,
    );
    for (const volume of owned.volumes) {
      assert.equal(
        resources.volumes.some((inspection) => inspection.Name === volume),
        true,
        `Refusing Compose cleanup for ${checkout.label}: owned volume identity changed.`,
      );
    }
  }
}

async function installClone(checkout) {
  await runBounded(pnpm, ['install', '--frozen-lockfile', '--prefer-offline'], {
    cwd: checkout.root,
    env: checkout.env,
    label: `${checkout.label}:install`,
    timeoutMs: INSTALL_TIMEOUT_MS,
  });
}

async function hello(checkout) {
  await runBounded(pnpm, ['hello'], {
    cwd: checkout.root,
    env: checkout.env,
    label: `${checkout.label}:hello`,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  checkout.config = readConfigSource(
    await readFile(join(checkout.root, 'project.config.json'), 'utf8'),
    `${checkout.label}/project.config.json`,
  );
  checkout.env.DB_PORT = String(checkout.config.dbPort);
  process.stdout.write(`[${checkout.label}] selected ${JSON.stringify(checkout.config)}\n`);
}

function assertChildStillRunning(checkout) {
  if (!checkout.go?.result) return;
  throw new Error(
    `${checkout.label} pnpm go exited before readiness with ${
      checkout.go.result.signal ?? `code ${checkout.go.result.code}`
    }.\n${formatChildDiagnostics(checkout.go)}`,
  );
}

async function startCheckout(checkout) {
  assert.equal(
    checkout.cleanup.prestateEmpty,
    true,
    `${checkout.label} Compose prestate was not verified empty.`,
  );
  checkout.cleanup.goAttempted = true;
  checkout.go = startLogged(pnpm, ['go'], {
    cwd: checkout.root,
    env: checkout.env,
    label: `${checkout.label}:go`,
  });
  await settleAll([verifyApi(checkout), verifyWeb(checkout)], `${checkout.label} readiness`);
  assertChildStillRunning(checkout);
  checkout.compose = await inspectCheckoutCompose(checkout);
  checkout.cleanup.owned = checkout.compose;
}

async function fetchBounded(url) {
  return fetch(url, { signal: AbortSignal.timeout(2_000) });
}

async function verifyApi(checkout) {
  const url = `http://127.0.0.1:${checkout.config.serverPort}/health`;
  await waitUntil(`${checkout.label} API health`, START_TIMEOUT_MS, async () => {
    assertChildStillRunning(checkout);
    try {
      const response = await fetchBounded(url);
      if (!response.ok) return null;
      const body = await response.json();
      return body.status === 'ok' && body.db === 'connected' ? body : null;
    } catch {
      return null;
    }
  });
  process.stdout.write(`[${checkout.label}] healthy API with connected DB: ${url}\n`);
}

async function verifyWeb(checkout) {
  const url = `http://localhost:${checkout.config.webPort}/`;
  await waitUntil(`${checkout.label} localhost web`, START_TIMEOUT_MS, async () => {
    assertChildStillRunning(checkout);
    try {
      const response = await fetchBounded(url);
      return response.ok ? response.status : null;
    } catch {
      return null;
    }
  });
  process.stdout.write(`[${checkout.label}] healthy localhost web: ${url}\n`);
}

async function waitUntil(label, timeoutMs, check, intervalMs = 500) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
      if (!/ECONNREFUSED|fetch failed|No such container/.test(error.message)) throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${label}.${lastError ? ` Last error: ${lastError.message}` : ''}`,
  );
}

async function inspectCheckoutCompose(checkout) {
  const project = composeProjectName(checkout.root);
  const ps = await runBounded(
    'docker',
    ['compose', '--project-name', project, 'ps', '--all', '--quiet', 'postgres'],
    {
      cwd: checkout.root,
      env: checkout.env,
      label: `${checkout.label}:compose-ps`,
      timeoutMs: 20_000,
    },
  );
  const ids = ps.stdout.trim().split(/\s+/).filter(Boolean);
  assert.equal(ids.length, 1, `${checkout.label} must own exactly one Postgres container.`);
  const inspection = await inspectContainer(ids[0], checkout.env, `${checkout.label}:inspect`);
  const labels = inspection.Config?.Labels ?? {};
  assert.equal(labels['com.docker.compose.project'], project);
  assert.equal(labels['com.docker.compose.service'], 'postgres');
  assert.equal(inspection.State?.Status, 'running');
  assert.equal(inspection.State?.Health?.Status, 'healthy');
  const volumes = (inspection.Mounts ?? [])
    .filter((mount) => mount.Type === 'volume')
    .map((mount) => mount.Name);
  assert.equal(volumes.length, 1, `${checkout.label} must own exactly one named Postgres volume.`);
  return {
    project,
    containerId: inspection.Id,
    containerName: String(inspection.Name).replace(/^\//, ''),
    volumes,
  };
}

export function assertDistinctResources(first, second) {
  assert.notEqual(first.project, second.project, 'Compose project names must differ.');
  assert.notEqual(first.containerId, second.containerId, 'Compose container IDs must differ.');
  assert.notEqual(
    first.containerName,
    second.containerName,
    'Compose container names must differ.',
  );
  assert.equal(
    first.volumes.some((volume) => second.volumes.includes(volume)),
    false,
    'Compose volume names must differ.',
  );
}

function assertAllPortsDistinct(first, second) {
  const ports = [...ROGUE_PORTS, ...Object.values(first.config), ...Object.values(second.config)];
  assert.equal(
    new Set(ports).size,
    ports.length,
    `Every rogue/A/B port must differ: ${ports.join(', ')}`,
  );
}

async function psql(checkout, sql, label) {
  const result = await runBounded(
    'docker',
    [
      'exec',
      checkout.compose.containerId,
      'psql',
      '-X',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atqc',
      sql,
    ],
    { env: checkout.env, label, timeoutMs: 20_000 },
  );
  return result.stdout.trim();
}

async function proveDatabaseIsolation(first, second) {
  await psql(
    first,
    `CREATE TABLE ${MARKER_RELATION} (value text PRIMARY KEY); INSERT INTO ${MARKER_RELATION} VALUES ('${MARKER_VALUE}');`,
    `${first.label}:marker-write`,
  );
  assert.equal(
    await psql(
      second,
      `SELECT to_regclass('public.${MARKER_RELATION}') IS NULL;`,
      `${second.label}:marker-absence`,
    ),
    't',
    'Clone B unexpectedly contains clone A marker relation.',
  );
}

async function verifyMarker(checkout) {
  assert.equal(
    await psql(checkout, `SELECT value FROM ${MARKER_RELATION};`, `${checkout.label}:marker-read`),
    MARKER_VALUE,
  );
}

async function stopCheckoutAuthenticated(checkout) {
  if (!checkout.go || checkout.go.result) return;
  await runBounded(pnpm, ['stop'], {
    cwd: checkout.root,
    env: checkout.env,
    label: `${checkout.label}:stop`,
    timeoutMs: STOP_TIMEOUT_MS,
  });
  const result = await waitForChildExit(checkout.go, STOP_TIMEOUT_MS);
  if (!result) throw new Error(`${checkout.label} pnpm go did not exit after authenticated stop.`);
  checkout.stopped = true;
  process.stdout.write(
    `[${checkout.label}] owned pnpm go exited after authenticated stop (${result.signal ?? result.code}).\n`,
  );
}

async function assertDevPortsReleased(checkout) {
  for (const port of [checkout.config.serverPort, checkout.config.webPort]) {
    assert.equal(
      await isPortAvailable(port),
      true,
      `${checkout.label} dev port ${port} is still occupied.`,
    );
  }
}

async function diagnose(checkouts, rogue, env) {
  process.stderr.write('[diagnostics] collecting bounded Docker and child-process state\n');
  await runBounded('docker', ['ps', '--all', '--no-trunc'], {
    env,
    label: 'diagnostics:docker-ps',
    timeoutMs: 20_000,
  }).catch((error) => process.stderr.write(`[diagnostics] ${error.message}\n`));
  for (const checkout of checkouts) {
    if (!checkout?.root) continue;
    process.stderr.write(
      `[diagnostics:${checkout.label}] config=${JSON.stringify(checkout.config)}\n${
        checkout.go ? formatChildDiagnostics(checkout.go) : 'pnpm go not started'
      }\n`,
    );
    await runBounded(
      'docker',
      ['compose', '--project-name', composeProjectName(checkout.root), 'ps', '--all'],
      {
        cwd: checkout.root,
        env: { ...checkout.env, DB_PORT: String(checkout.config?.dbPort ?? 1) },
        label: `diagnostics:${checkout.label}:compose`,
        timeoutMs: 20_000,
      },
    ).catch((error) => process.stderr.write(`[diagnostics] ${error.message}\n`));
  }
  if (rogue.creationAttempted) {
    await readRogueLogs(rogue, env, true).catch((error) =>
      process.stderr.write(`[diagnostics] ${error.message}\n`),
    );
  }
}

async function cleanupCheckout(checkout, errors) {
  if (!checkout?.root) return;
  if (checkout.go && !checkout.go.result) {
    try {
      await stopCheckoutAuthenticated(checkout);
    } catch (error) {
      errors.push(
        new Error(`${checkout.label} authenticated cleanup stop failed: ${error.message}`),
      );
      try {
        await terminateOwnedChild(checkout.go);
      } catch (fallbackError) {
        errors.push(
          new Error(`${checkout.label} owned-child fallback failed: ${fallbackError.message}`),
        );
      }
    }
  }
  if (!composeCleanupEligible(checkout)) {
    process.stdout.write(
      `[${checkout.label}] skipping Compose cleanup: no eligible owned go attempt.\n`,
    );
    return;
  }
  try {
    const resources = await inspectProjectResources(checkout);
    assertComposeCleanupOwnership(checkout, resources);
    if (resourceReferenceCount(resources.references) === 0) return;
    const confirmed = await projectResourceReferences(
      checkout,
      `${checkout.label}:cleanup-confirm`,
    );
    assert.deepEqual(
      confirmed,
      resources.references,
      `Refusing Compose cleanup for ${checkout.label}: project resources changed during ownership validation.`,
    );
    await runBounded(
      'docker',
      [
        'compose',
        '--project-name',
        composeProjectName(checkout.root),
        'down',
        '--volumes',
        '--remove-orphans',
      ],
      {
        cwd: checkout.root,
        env: { ...checkout.env, DB_PORT: String(checkout.config?.dbPort ?? 1) },
        label: `${checkout.label}:cleanup-compose`,
        timeoutMs: COMMAND_TIMEOUT_MS,
      },
    );
    const remaining = await projectResourceReferences(
      checkout,
      `${checkout.label}:cleanup-poststate`,
    );
    assert.equal(
      resourceReferenceCount(remaining),
      0,
      `${checkout.label} Compose cleanup left owned resources behind: ${JSON.stringify(remaining)}.`,
    );
  } catch (error) {
    const refusal = new Error(
      `${checkout.label} Compose cleanup refused after ownership diagnostics: ${error.message}`,
      { cause: error },
    );
    process.stderr.write(`[${checkout.label}:cleanup-refused] ${refusal.message}\n`);
    errors.push(refusal);
  }
}

async function removeOwnedRogue(rogue, env, errors) {
  if (!rogue.creationAttempted) return;
  try {
    const inspection = await inspectContainer(
      rogue.containerId ?? rogue.name,
      env,
      'rogue:cleanup-inspect',
    );
    if (inspection.Config?.Labels?.['app-starter.clean-clone-e2e'] !== rogue.runId) {
      errors.push(
        new Error(`Refusing to remove rogue container ${rogue.name}: ownership label mismatch.`),
      );
      return;
    }
    await runBounded('docker', ['rm', '--force', inspection.Id], {
      env,
      label: 'rogue:cleanup-remove',
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
  } catch (error) {
    if (!/No such object|No such container/.test(error.message)) errors.push(error);
  }
}

async function currentCommit(env) {
  const result = await runBounded('git', ['rev-parse', 'HEAD'], {
    env,
    label: 'source:commit',
    timeoutMs: 20_000,
  });
  return result.stdout.trim();
}

export async function main() {
  const startedAt = Date.now();
  const env = cleanChildEnvironment();
  const runId = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const rogue = {
    runId,
    name: `app-starter-clean-clone-rogue-${runId}`,
    creationAttempted: false,
    containerId: null,
    baseline: null,
  };
  const checkouts = [];
  let temporaryRoot;
  let primaryError;
  const cleanupErrors = [];

  try {
    await assertDockerAvailable(env);
    await assertCandidatesAvailable();
    const commit = await currentCommit(env);
    temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), 'app-starter-clean-clone-e2e-')));
    process.stdout.write(`[harness] source commit ${commit}; temporary root ${temporaryRoot}\n`);
    await startRoguePostgres(rogue, env);

    const [first, second] = await settleAll(
      [
        createClone(repoRoot, commit, join(temporaryRoot, 'clone-a'), 'clone-a', env),
        createClone(repoRoot, commit, join(temporaryRoot, 'clone-b'), 'clone-b', env),
      ],
      'clean clone creation',
    );
    checkouts.push(first, second);
    assert.notEqual(
      first.cleanup.project,
      second.cleanup.project,
      'Temporary checkouts must have distinct Compose project identities.',
    );
    await settleAll(checkouts.map(prepareComposeCleanup), 'Compose project prestate checks');
    await settleAll(checkouts.map(installClone), 'clean clone installation');

    await hello(first);
    await startCheckout(first);
    await hello(second);
    await startCheckout(second);

    assertAllPortsDistinct(first, second);
    assertDistinctResources(first.compose, second.compose);
    await proveDatabaseIsolation(first, second);

    await stopCheckoutAuthenticated(second);
    await assertDevPortsReleased(second);
    await settleAll(
      [verifyApi(first), verifyWeb(first), verifyMarker(first)],
      'clone A post-stop verification',
    );
    first.compose = await inspectCheckoutCompose(first);
    first.cleanup.owned = first.compose;

    const finalRogueLogs = await readRogueLogs(rogue, env, false);
    const finalRogueInspection = await inspectContainer(
      rogue.containerId,
      env,
      'rogue:final-inspect',
    );
    const rogueResult = assertRogueProof(
      rogue,
      finalRogueInspection,
      rogue.baseline,
      finalRogueLogs,
    );
    process.stdout.write(
      `[rogue] post-baseline connections=${rogueResult.connectionCount}, statements=${rogueResult.statementCount}, application-table mentions=${rogueResult.applicationTableCount}.\n`,
    );
    process.stdout.write(
      `[harness] clean-clone isolation E2E passed in ${Math.round((Date.now() - startedAt) / 1000)}s.\n`,
    );
  } catch (error) {
    primaryError = error;
    await diagnose(checkouts, rogue, env);
  } finally {
    for (const checkout of [...checkouts].reverse()) {
      await cleanupCheckout(checkout, cleanupErrors);
    }
    await removeOwnedRogue(rogue, env, cleanupErrors);
    if (temporaryRoot) {
      try {
        await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }

  if (primaryError && cleanupErrors.length) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      'E2E failed and cleanup also failed.',
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'E2E cleanup failed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
