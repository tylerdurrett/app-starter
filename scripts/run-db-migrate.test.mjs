import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveDatabaseEnvironment } from './database-env.mjs';
import { runDatabaseMigration } from './run-db-migrate.mjs';

test('readiness and migration receive byte-identical resolved database settings', async () => {
  const resolved = resolveDatabaseEnvironment({
    config: { dbPort: 6150 },
    fileEnv: {},
    inheritedEnv: { UNRELATED: 'preserved' },
  });
  const calls = [];

  await runDatabaseMigration(resolved, async (command, args, env) => {
    calls.push({ command, args, env, serializedEnv: JSON.stringify(env) });
  });

  assert.deepEqual(
    calls.map(({ args }) => args),
    [['scripts/wait-for-db.mjs'], ['exec', 'drizzle-kit', 'migrate']],
  );
  assert.equal(calls[0].command, process.execPath);
  assert.equal(calls[1].command, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  assert.equal(calls[0].env, resolved.childEnv);
  assert.equal(calls[1].env, resolved.childEnv);
  assert.equal(calls[0].serializedEnv, calls[1].serializedEnv);
});

test('migration does not run when readiness fails', async () => {
  const resolved = resolveDatabaseEnvironment({
    config: { dbPort: 6150 },
    fileEnv: {},
    inheritedEnv: {},
  });
  let calls = 0;

  await assert.rejects(
    runDatabaseMigration(resolved, async () => {
      calls += 1;
      throw new Error('database not ready');
    }),
    /database not ready/,
  );
  assert.equal(calls, 1);
});
