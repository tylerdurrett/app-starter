#!/usr/bin/env node

/**
 * Pre-dev port cleanup for `pnpm go`.
 *
 * Frees the configured server/web ports before `turbo run dev` starts them.
 * Guards against orphaned `tsx watch` grandchildren that survive Ctrl-C under
 * WSL2/pnpm, leaving stale listeners on serverPort/webPort.
 *
 * Does NOT touch dbPort — Postgres runs in Docker and is managed separately.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const configPath = resolve(repoRoot, 'project.config.json');

function getPorts() {
  const raw = readFileSync(configPath, 'utf-8');
  const { serverPort, webPort } = JSON.parse(raw);
  return [serverPort, webPort].filter((p) => typeof p === 'number');
}

function pidsOnPort(port) {
  try {
    const out = execSync(`lsof -ti :${port} -sTCP:LISTEN`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (!out) return [];
    return out.split('\n').map((s) => Number(s)).filter(Number.isFinite);
  } catch {
    // lsof exits 1 when nothing matches — treat as "no pids".
    return [];
  }
}

function signal(pid, sig) {
  try {
    process.kill(pid, sig);
  } catch {
    // Already gone.
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function freePort(port) {
  let pids = pidsOnPort(port);
  if (pids.length === 0) return;

  console.log(`Port ${port} held by PID(s) ${pids.join(', ')} — sending SIGTERM…`);
  for (const pid of pids) signal(pid, 'SIGTERM');
  await sleep(500);

  pids = pidsOnPort(port);
  if (pids.length === 0) return;

  console.log(`Port ${port} still held — sending SIGKILL to ${pids.join(', ')}`);
  for (const pid of pids) signal(pid, 'SIGKILL');
  await sleep(200);

  pids = pidsOnPort(port);
  if (pids.length > 0) {
    console.error(`Port ${port} still held by ${pids.join(', ')} after SIGKILL.`);
    process.exit(1);
  }
}

async function main() {
  for (const port of getPorts()) {
    await freePort(port);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
