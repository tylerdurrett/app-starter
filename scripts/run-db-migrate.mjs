#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveDatabaseEnvironment } from './database-env.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

export function run(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else
        reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

/** Run readiness and migration with the exact same resolved child environment. */
export async function runDatabaseMigration(
  resolved = resolveDatabaseEnvironment(),
  runCommand = run,
) {
  const { childEnv } = resolved;
  await runCommand(process.execPath, ['scripts/wait-for-db.mjs'], childEnv);
  await runCommand(pnpm, ['exec', 'drizzle-kit', 'migrate'], childEnv);
}

export async function main() {
  await runDatabaseMigration();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
