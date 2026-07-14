import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  composeDatabaseUrl,
  parseDatabaseUrl,
  resolveDatabaseEnvironment,
} from './database-env.mjs';

const config = { dbPort: 6150 };

describe('resolveDatabaseEnvironment', () => {
  it('parses .env before overlaying inherited environment values', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'app-starter-database-env-'));
    try {
      await writeFile(
        join(repoRoot, '.env'),
        'DATABASE_MODE=external\nDATABASE_URL="postgresql://file:secret@db.example.com/file"\nFILE_ONLY=yes\n',
      );
      const resolved = resolveDatabaseEnvironment({
        repoRoot,
        inheritedEnv: {
          DATABASE_URL: 'postgresql://inherited:secret@db.example.com/inherited',
          INHERITED_ONLY: 'yes',
        },
      });

      assert.equal(resolved.databaseUrl, 'postgresql://inherited:secret@db.example.com/inherited');
      assert.equal(resolved.childEnv.FILE_ONLY, 'yes');
      assert.equal(resolved.childEnv.INHERITED_ONLY, 'yes');
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('defaults to compose and ignores a custom or reachable-looking URL', () => {
    const resolved = resolveDatabaseEnvironment({
      config,
      fileEnv: { DATABASE_URL: 'postgresql://other-project.example.com/unsafe' },
      inheritedEnv: {},
    });

    assert.equal(resolved.mode, 'compose');
    assert.equal(resolved.databaseUrl, composeDatabaseUrl(config.dbPort));
    assert.equal(resolved.hostname, '127.0.0.1');
    assert.equal(resolved.port, config.dbPort);
    assert.equal(resolved.childEnv.DATABASE_MODE, 'compose');
    assert.equal(resolved.childEnv.DATABASE_URL, composeDatabaseUrl(config.dbPort));
    assert.equal(resolved.childEnv.DB_PORT, String(config.dbPort));
  });

  it('lets inherited compose mode override external file configuration', () => {
    const resolved = resolveDatabaseEnvironment({
      config,
      fileEnv: {
        DATABASE_MODE: 'external',
        DATABASE_URL: 'postgresql://file.example.com/file',
      },
      inheritedEnv: { DATABASE_MODE: 'compose' },
    });

    assert.equal(resolved.mode, 'compose');
    assert.equal(resolved.databaseUrl, composeDatabaseUrl(config.dbPort));
  });

  it('uses an external URL only when external mode is explicit', () => {
    const databaseUrl = 'postgres://user:password@database.example.com:6543/app';
    const resolved = resolveDatabaseEnvironment({
      fileEnv: { DATABASE_MODE: 'external', DATABASE_URL: databaseUrl },
      inheritedEnv: {},
    });

    assert.equal(resolved.mode, 'external');
    assert.equal(resolved.databaseUrl, databaseUrl);
    assert.equal(resolved.hostname, 'database.example.com');
    assert.equal(resolved.port, 6543);
    assert.equal(resolved.childEnv.DB_PORT, '6543');
  });

  it('rejects unset URLs, non-Postgres URLs, and malformed URLs in external mode', () => {
    for (const databaseUrl of [
      undefined,
      '',
      'not a url',
      'mysql://db.example.com/app',
      'postgresql://db.example.com:0/app',
    ]) {
      assert.throws(
        () =>
          resolveDatabaseEnvironment({
            fileEnv: { DATABASE_MODE: 'external', DATABASE_URL: databaseUrl },
            inheritedEnv: {},
          }),
        /explicit DATABASE_URL|valid PostgreSQL URL|port between/,
      );
    }
  });

  it('rejects unknown modes instead of silently choosing a database', () => {
    for (const mode of ['', 'COMPOSE', 'local', 'External']) {
      assert.throws(
        () =>
          resolveDatabaseEnvironment({
            config,
            fileEnv: { DATABASE_MODE: mode },
            inheritedEnv: {},
          }),
        /Invalid DATABASE_MODE/,
      );
    }
  });

  it('applies child overrides before making database settings authoritative', () => {
    const resolved = resolveDatabaseEnvironment({
      config,
      fileEnv: {},
      inheritedEnv: { UNRELATED: 'preserved' },
      childEnvOverrides: {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://wrong.example.com/wrong',
      },
    });

    assert.equal(resolved.childEnv.UNRELATED, 'preserved');
    assert.equal(resolved.childEnv.NODE_ENV, 'test');
    assert.equal(resolved.childEnv.DATABASE_URL, composeDatabaseUrl(config.dbPort));
  });
});

describe('parseDatabaseUrl', () => {
  it('uses the PostgreSQL default port when the URL omits one', () => {
    assert.deepEqual(parseDatabaseUrl('postgresql://db.example.com/app'), {
      hostname: 'db.example.com',
      port: 5432,
    });
  });

  it('does not retain credentials when URL parsing fails', () => {
    const secret = 'do-not-log-this-password';
    let failure;
    try {
      parseDatabaseUrl(`postgresql://admin:${secret}@[invalid-host/app`);
    } catch (error) {
      failure = error;
    }

    assert.ok(failure);
    assert.equal(failure.cause, undefined);
    assert.match(failure.message, /valid PostgreSQL URL/);
    assert.doesNotMatch(failure.stack, new RegExp(secret));
  });
});
