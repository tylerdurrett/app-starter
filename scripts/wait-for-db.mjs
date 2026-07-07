#!/usr/bin/env node

/**
 * Postgres readiness gate for `pnpm go`.
 *
 * 1. Checks whether local Postgres is reachable on the configured port.
 * 2. If not, starts Docker Compose.
 * 3. Polls until Postgres accepts connections (up to 30 s).
 */

import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const configPath = resolve(repoRoot, 'project.config.json');

const DB_HOST = '127.0.0.1';
const TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;

/** Read dbPort from project.config.json. */
function getDbPort() {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.dbPort === 'number') return parsed.dbPort;
  } catch {
    // fall through
  }
  console.error('Missing dbPort in project.config.json — run `pnpm hello` first.');
  process.exit(1);
}

function isReachable(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: DB_HOST, port });
    socket.setTimeout(POLL_INTERVAL_MS);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForReady(port) {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await isReachable(port)) return true;
    // Fast connection refusals return immediately, so sleep to avoid a busy loop.
    await sleep(POLL_INTERVAL_MS);
  }

  return false;
}

/** Start Postgres via Docker Compose (non-blocking). */
function startPostgres() {
  console.log('Starting Postgres via Docker Compose…');

  const child = spawn(
    'docker',
    ['compose', 'up', '-d'],
    { stdio: 'inherit', cwd: repoRoot },
  );

  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker compose up -d exited with code ${code}`));
    });
    child.on('error', (err) => reject(err));
  });
}

async function main() {
  const port = getDbPort();

  if (await isReachable(port)) {
    console.log(`Postgres is reachable on ${DB_HOST}:${port}.`);
    return;
  }

  // Always run `docker compose up -d` — it's idempotent and will recreate the
  // container if the port mapping changed (e.g. after `pnpm hello` picked a new port).
  await startPostgres();

  if (await isReachable(port)) {
    console.log(`Postgres is reachable on ${DB_HOST}:${port}.`);
    return;
  }

  console.log(`Waiting up to ${TIMEOUT_MS / 1000}s for Postgres on ${DB_HOST}:${port}…`);
  const ready = await waitForReady(port);

  if (!ready) {
    console.error(
      `Timed out after ${TIMEOUT_MS / 1000}s waiting for Postgres on ${DB_HOST}:${port}.`,
    );
    console.error('Is Docker running? Try: pnpm db:start');
    process.exit(1);
  }

  console.log(`Postgres is reachable on ${DB_HOST}:${port}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
