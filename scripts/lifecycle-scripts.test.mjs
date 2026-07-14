import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const { scripts } = packageJson;
const execFileAsync = promisify(execFile);
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

describe('development lifecycle script wiring', () => {
  it('guards ports before database work and repeats the guard at supervised startup', () => {
    assert.deepEqual(scripts.go.split(' && '), [
      'node scripts/setup.mjs --ensure',
      'node scripts/dev-supervisor.mjs preflight',
      'node scripts/run-db-migrate.mjs',
      'node scripts/dev-supervisor.mjs start -- turbo run dev',
    ]);
  });

  it('stops only the authenticated supervisor for this checkout', () => {
    assert.equal(scripts.stop, 'node scripts/dev-supervisor.mjs stop');
  });

  it('routes managed database operations through namespaced helpers', () => {
    assert.equal(scripts['db:start'], 'node scripts/compose.mjs up -d');
    assert.equal(scripts['db:stop'], 'node scripts/compose.mjs down');
    assert.deepEqual(scripts['db:reset'].split(' && '), [
      'node scripts/compose.mjs --require-compose-database down -v',
      'node scripts/run-db-migrate.mjs',
      'pnpm db:seed',
    ]);
    assert.equal(scripts['db:migrate'], 'node scripts/run-db-migrate.mjs');
  });

  it('refuses the db:reset package command in explicit external mode', async () => {
    await assert.rejects(
      execFileAsync(pnpm, ['db:reset'], {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_MODE: 'external',
          DATABASE_URL: 'postgresql://database.example.com/app',
        },
      }),
      (error) => {
        assert.match(error.stderr, /Refusing to reset.*DATABASE_MODE=external/);
        return true;
      },
    );
  });

  it('contains no kill-by-port lifecycle path', () => {
    assert.equal(existsSync(resolve(repoRoot, 'scripts/free-dev-ports.mjs')), false);
    assert.doesNotMatch(JSON.stringify(scripts), /free-dev-ports|lsof|kill/);
  });
});
