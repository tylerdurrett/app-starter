#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildComposeCommand, composeProjectName, runCompose } from './compose.mjs';
import { resolveDatabaseEnvironment } from './database-env.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POSTGRES_SERVICE = 'postgres';
const TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

function endpoint(hostname, port) {
  const normalizedHostname = normalizeHostname(hostname);
  return `${normalizedHostname.includes(':') ? `[${normalizedHostname}]` : normalizedHostname}:${port}`;
}

function normalizeHostname(hostname) {
  if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname.slice(1, -1);
  return hostname;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** Test whether a TCP endpoint accepts a connection within the supplied bound. */
export function isReachable(hostname, port, timeoutMs = POLL_INTERVAL_MS) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: normalizeHostname(hostname), port });
    let settled = false;

    function finish(reachable) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(reachable);
    }

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

function runCaptured(command, args, { cwd, env }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }

      const detail = stderr.trim();
      reject(
        new Error(
          `${command} ${args.join(' ')} exited with ${signal ?? `code ${code}`}${detail ? `: ${detail}` : ''}`,
        ),
      );
    });
  });
}

/** Return the sole container owned by the checkout's Postgres service. */
export async function findPostgresContainer(
  { checkoutRoot = repoRoot, env = process.env } = {},
  execute = runCaptured,
) {
  const command = buildComposeCommand(['ps', '--all', '--quiet', POSTGRES_SERVICE], {
    checkoutRoot,
  });
  const output = await execute(command.command, command.args, {
    cwd: command.cwd,
    env,
  });
  const containerIds = output.trim().split(/\s+/).filter(Boolean);

  if (containerIds.length === 0) {
    throw new Error('Compose did not create a Postgres service container for this checkout.');
  }
  if (containerIds.length !== 1) {
    throw new Error(
      `Expected one Postgres service container for this checkout, found ${containerIds.length}.`,
    );
  }

  return containerIds[0];
}

/** Read Docker's authoritative labels and health state for a container. */
export async function inspectContainer(containerId, execute = runCaptured) {
  const output = await execute('docker', ['inspect', containerId], {
    cwd: repoRoot,
    env: process.env,
  });

  let inspections;
  try {
    inspections = JSON.parse(output);
  } catch {
    throw new Error('Docker returned invalid container inspection data.');
  }

  if (!Array.isArray(inspections) || inspections.length !== 1) {
    throw new Error('Docker did not return exactly one container inspection.');
  }
  return inspections[0];
}

/** Require Docker metadata proving that the expected container is owned and ready. */
export function assertOwnedHealthyContainer(inspection, expectedProject) {
  const labels = inspection?.Config?.Labels ?? {};
  const project = labels['com.docker.compose.project'];
  const service = labels['com.docker.compose.service'];
  const status = inspection?.State?.Status;
  const health = inspection?.State?.Health?.Status;

  if (project !== expectedProject) {
    throw new Error("Postgres container does not belong to this checkout's Compose project.");
  }
  if (service !== POSTGRES_SERVICE) {
    throw new Error('Compose container is not the expected Postgres service.');
  }
  if (status !== 'running') {
    throw new Error(`Checkout-owned Postgres container is ${status ?? 'in an unknown state'}.`);
  }
  if (health !== 'healthy') {
    throw new Error(`Checkout-owned Postgres container is ${health ?? 'missing a health status'}.`);
  }
}

/** Start and verify this checkout's own Compose-managed Postgres. */
export async function waitForComposeDatabase(
  resolved,
  {
    checkoutRoot = repoRoot,
    runComposeCommand = runCompose,
    findContainer = findPostgresContainer,
    inspect = inspectContainer,
  } = {},
) {
  const composeOptions = { checkoutRoot, env: resolved.childEnv };
  await runComposeCommand(
    ['up', '-d', '--wait', '--wait-timeout', String(TIMEOUT_MS / 1000), POSTGRES_SERVICE],
    composeOptions,
  );

  const containerId = await findContainer(composeOptions);
  const inspection = await inspect(containerId);
  assertOwnedHealthyContainer(inspection, composeProjectName(checkoutRoot));

  console.log(
    `Checkout-owned Postgres is healthy on ${endpoint(resolved.hostname, resolved.port)}.`,
  );
}

/** Poll only an explicitly configured external database endpoint. */
export async function waitForExternalDatabase(
  resolved,
  {
    timeoutMs = TIMEOUT_MS,
    pollIntervalMs = POLL_INTERVAL_MS,
    checkReachable = isReachable,
    now = Date.now,
    delay = sleep,
  } = {},
) {
  const startedAt = now();
  const hostname = normalizeHostname(resolved.hostname);
  const address = endpoint(resolved.hostname, resolved.port);

  while (now() - startedAt < timeoutMs) {
    const elapsed = now() - startedAt;
    const remaining = timeoutMs - elapsed;
    if (await checkReachable(hostname, resolved.port, Math.min(pollIntervalMs, remaining))) {
      console.log(`External Postgres is reachable on ${address}.`);
      return;
    }

    const waitMs = Math.min(pollIntervalMs, timeoutMs - (now() - startedAt));
    if (waitMs > 0) await delay(waitMs);
  }

  throw new Error(
    `Timed out after ${timeoutMs / 1000}s waiting for external Postgres on ${address}.`,
  );
}

export async function waitForDatabase(resolved = resolveDatabaseEnvironment(), dependencies = {}) {
  if (resolved.mode === 'compose') {
    await waitForComposeDatabase(resolved, dependencies);
    return;
  }
  await waitForExternalDatabase(resolved, dependencies);
}

export async function main() {
  await waitForDatabase(resolveDatabaseEnvironment());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
