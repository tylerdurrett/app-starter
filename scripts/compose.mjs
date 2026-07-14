#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HASH_LENGTH = 12;

/** Resolve aliases so the same checkout always has one Compose identity. */
export function canonicalCheckoutRoot(checkoutRoot = repoRoot) {
  return realpathSync(checkoutRoot);
}

/** Return a valid, checkout-specific Docker Compose project name. */
export function composeProjectName(checkoutRoot = repoRoot) {
  const canonicalRoot = canonicalCheckoutRoot(checkoutRoot);
  const hash = createHash('sha256').update(canonicalRoot).digest('hex').slice(0, HASH_LENGTH);
  return `app-starter-${hash}`;
}

/** Build the Docker Compose invocation used by all managed database commands. */
export function buildComposeCommand(args, { checkoutRoot = repoRoot } = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new TypeError('Compose arguments must be an array of strings');
  }

  const cwd = canonicalCheckoutRoot(checkoutRoot);
  return {
    command: 'docker',
    args: ['compose', '--project-name', composeProjectName(cwd), ...args],
    cwd,
  };
}

/** Run Docker Compose with this checkout's project namespace. */
export function runCompose(
  args,
  { checkoutRoot = repoRoot, spawnCommand = spawn, stdio = 'inherit', env = process.env } = {},
) {
  const command = buildComposeCommand(args, { checkoutRoot });

  return new Promise((resolvePromise, reject) => {
    const child = spawnCommand(command.command, command.args, {
      cwd: command.cwd,
      env,
      stdio,
    });

    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        reject(
          new Error(`docker compose ${args.join(' ')} exited with ${signal ?? `code ${code}`}`),
        );
      }
    });
  });
}

export async function main(args = process.argv.slice(2)) {
  await runCompose(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
