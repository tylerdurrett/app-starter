import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';
import { findFreePort, isPortAvailable, PORT_PROBE_HOSTS } from './port-availability.mjs';
import { parseEnvironmentFile } from './database-env.mjs';
import { askPort, resolveManagedEnv } from './setup.mjs';

const execFileAsync = promisify(execFile);

function listen(host = '127.0.0.1', port = 0) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function mockServerFactory(errorsByHost = {}) {
  const listened = [];
  const closed = [];

  class MockServer extends EventEmitter {
    unref() {}

    listen({ host }, callback) {
      listened.push(host);
      queueMicrotask(() => {
        const code = errorsByHost[host];
        if (code) {
          this.emit('error', Object.assign(new Error(`${host}: ${code}`), { code }));
        } else {
          callback();
        }
      });
    }

    close(callback) {
      closed.push(listened.at(-1));
      queueMicrotask(() => callback());
    }
  }

  return { createServerFn: () => new MockServer(), listened, closed };
}

async function createSetupFixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'app-starter-setup-')));
  const scriptsDirectory = join(directory, 'scripts');
  await mkdir(scriptsDirectory);
  await Promise.all([
    writeFile(join(directory, '.env'), ''),
    readFile(new URL('./setup.mjs', import.meta.url)).then((contents) =>
      writeFile(join(scriptsDirectory, 'setup.mjs'), contents),
    ),
    readFile(new URL('./port-availability.mjs', import.meta.url)).then((contents) =>
      writeFile(join(scriptsDirectory, 'port-availability.mjs'), contents),
    ),
    readFile(new URL('./database-env.mjs', import.meta.url)).then((contents) =>
      writeFile(join(scriptsDirectory, 'database-env.mjs'), contents),
    ),
    symlink(new URL('../node_modules', import.meta.url), join(directory, 'node_modules'), 'dir'),
  ]);
  return { directory, setupPath: join(scriptsDirectory, 'setup.mjs') };
}

describe('port availability', () => {
  it('detects a real IPv4 wildcard listener', async () => {
    const listener = await listen('0.0.0.0');

    try {
      assert.equal(await isPortAvailable(listener.address().port), false);
    } finally {
      await close(listener);
    }
  });

  it('detects a real IPv4 loopback listener and releases every probe', async () => {
    const listener = await listen();
    const { port } = listener.address();

    try {
      assert.equal(await isPortAvailable(port), false);
    } finally {
      await close(listener);
    }

    assert.equal(await isPortAvailable(port), true);
  });

  it('detects a real IPv6 loopback listener when IPv6 is supported', async (t) => {
    let listener;
    try {
      listener = await listen('::1');
    } catch (error) {
      if (error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL') {
        t.skip(`IPv6 loopback is unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    try {
      assert.equal(await isPortAvailable(listener.address().port), false);
    } finally {
      await close(listener);
    }
  });

  it('probes every bind shape and treats conflicts and denied binds as unavailable', async () => {
    for (const code of ['EADDRINUSE', 'EACCES']) {
      const mock = mockServerFactory({ '127.0.0.1': code });
      assert.equal(await isPortAvailable(5100, mock), false);
      assert.deepEqual(mock.listened, PORT_PROBE_HOSTS);
      assert.equal(mock.closed.length, PORT_PROBE_HOSTS.length);
    }
  });

  it('skips only unsupported IPv6 interfaces', async () => {
    const mock = mockServerFactory({ '::': 'EAFNOSUPPORT', '::1': 'EADDRNOTAVAIL' });

    assert.equal(await isPortAvailable(5100, mock), true);
    assert.deepEqual(mock.listened, PORT_PROBE_HOSTS);
    assert.equal(mock.closed.length, PORT_PROBE_HOSTS.length);
  });

  it('closes every probe and rejects unexpected socket errors', async () => {
    const mock = mockServerFactory({ '127.0.0.1': 'EMFILE' });

    await assert.rejects(isPortAvailable(5100, mock), { code: 'EMFILE' });
    assert.deepEqual(mock.listened, PORT_PROBE_HOSTS);
    assert.equal(mock.closed.length, PORT_PROBE_HOSTS.length);
  });

  it('skips occupied candidates when finding a port', async () => {
    const checked = [];
    const options = {
      createServerFn() {
        const server = new EventEmitter();
        server.unref = () => {};
        server.listen = ({ port }, callback) => {
          checked.push(port);
          queueMicrotask(() => {
            if (port === 5100) {
              server.emit('error', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' }));
            } else {
              callback();
            }
          });
        };
        server.close = (callback) => queueMicrotask(() => callback());
        return server;
      },
    };

    assert.equal(await findFreePort(5100, 5101, options), 5101);
    assert.ok(checked.includes(5100));
    assert.ok(checked.includes(5101));
  });
});

describe('interactive port selection', () => {
  it('rejects occupied input and re-prompts until an available port is chosen', async () => {
    const answers = ['5100', '5101'];
    const questions = [];
    const errors = [];

    const chosen = await askPort('Server', 5199, {
      askFn: async (question) => {
        questions.push(question);
        return answers.shift();
      },
      isPortAvailableFn: async (port) => port !== 5100,
      reportError: (message) => errors.push(message),
    });

    assert.equal(chosen, 5101);
    assert.equal(questions.length, 2);
    assert.deepEqual(errors, ['Port 5100 is already in use or unavailable.']);
  });
});

describe('--ensure config stability', () => {
  it('skips an occupied candidate when config is missing', async () => {
    const fixture = await createSetupFixture();
    let listener;
    try {
      listener = await listen('127.0.0.1', 5100);
    } catch (error) {
      if (error.code !== 'EADDRINUSE' && error.code !== 'EACCES') throw error;
    }

    try {
      await execFileAsync(process.execPath, [fixture.setupPath, '--ensure']);
      const config = JSON.parse(
        await readFile(join(fixture.directory, 'project.config.json'), 'utf8'),
      );
      assert.notEqual(config.serverPort, 5100);
    } finally {
      if (listener) await close(listener);
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it('does not rewrite occupied ports in an existing config', async () => {
    const fixture = await createSetupFixture();
    const config = { serverPort: 5100, dbPort: 5150, webPort: 5200 };
    const listener = await listen();
    config.serverPort = listener.address().port;
    await writeFile(
      join(fixture.directory, 'project.config.json'),
      `${JSON.stringify(config, null, 2)}\n`,
    );

    try {
      await execFileAsync(process.execPath, [fixture.setupPath, '--ensure']);
      const persisted = JSON.parse(
        await readFile(join(fixture.directory, 'project.config.json'), 'utf8'),
      );
      assert.deepEqual(persisted, config);
    } finally {
      await close(listener);
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it('writes compose mode and the configured local URL over a custom URL', async () => {
    const fixture = await createSetupFixture();
    const config = { serverPort: 6100, dbPort: 6150, webPort: 6200 };
    await writeFile(
      join(fixture.directory, 'project.config.json'),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    await writeFile(
      join(fixture.directory, '.env'),
      'DATABASE_URL=postgresql://another-project.example.com/app\n',
    );

    try {
      await execFileAsync(process.execPath, [fixture.setupPath, '--ensure']);
      const env = parseEnvironmentFile(await readFile(join(fixture.directory, '.env')));
      assert.equal(env.DATABASE_MODE, 'compose');
      assert.equal(env.DB_PORT, '6150');
      assert.equal(env.DATABASE_URL, 'postgresql://postgres:postgres@127.0.0.1:6150/postgres');
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });

  it('preserves a valid URL from an explicitly external .env', async () => {
    const fixture = await createSetupFixture();
    const config = { serverPort: 6100, dbPort: 6150, webPort: 6200 };
    const databaseUrl = 'postgresql://user:secret@database.example.com:6543/app';
    await writeFile(
      join(fixture.directory, 'project.config.json'),
      `${JSON.stringify(config, null, 2)}\n`,
    );
    await writeFile(
      join(fixture.directory, '.env'),
      `DATABASE_MODE=external\nDATABASE_URL=${databaseUrl}\n`,
    );

    try {
      await execFileAsync(process.execPath, [fixture.setupPath, '--ensure']);
      const env = parseEnvironmentFile(await readFile(join(fixture.directory, '.env')));
      assert.equal(env.DATABASE_MODE, 'external');
      assert.equal(env.DB_PORT, '6150');
      assert.equal(env.DATABASE_URL, databaseUrl);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  });
});

describe('resolveManagedEnv', () => {
  it('keeps localhost defaults in sync with configured ports', () => {
    const env = resolveManagedEnv(
      {
        CORS_ORIGIN: 'http://localhost:5200',
        VITE_SERVER_URL: 'http://localhost:5100',
        BETTER_AUTH_URL: 'http://localhost:5100',
        MCP_CANONICAL_URL: 'http://localhost:5100/mcp',
        AUTH_REQUIRE_EMAIL_VERIFICATION: 'true',
      },
      { dbPort: 6150, webPort: 6200, serverPort: 6100 },
    );

    assert.equal(env.CORS_ORIGIN, 'http://localhost:6200');
    assert.equal(env.VITE_SERVER_URL, 'http://localhost:6100');
    assert.equal(env.BETTER_AUTH_URL, 'http://localhost:6100');
    assert.equal(env.MCP_CANONICAL_URL, 'http://localhost:6100/mcp');
    assert.equal(env.AUTH_REQUIRE_EMAIL_VERIFICATION, 'true');
    assert.equal(env.DATABASE_MODE, 'compose');
    assert.equal(env.DATABASE_URL, 'postgresql://postgres:postgres@127.0.0.1:6150/postgres');
  });

  it('preserves production-like HTTPS origins across pnpm go', () => {
    const env = resolveManagedEnv(
      {
        CORS_ORIGIN: 'https://app.example.com',
        VITE_SERVER_URL: 'https://api.example.com',
        BETTER_AUTH_URL: 'https://api.example.com',
        MCP_CANONICAL_URL: 'https://api.example.com/mcp',
      },
      { dbPort: 5150, webPort: 5200, serverPort: 5100 },
    );

    assert.equal(env.CORS_ORIGIN, 'https://app.example.com');
    assert.equal(env.VITE_SERVER_URL, 'https://api.example.com');
    assert.equal(env.BETTER_AUTH_URL, 'https://api.example.com');
    assert.equal(env.MCP_CANONICAL_URL, 'https://api.example.com/mcp');
    assert.equal(env.AUTH_REQUIRE_EMAIL_VERIFICATION, 'false');
  });

  it('replaces a custom URL unless external mode is explicit', () => {
    const env = resolveManagedEnv(
      { DATABASE_URL: 'postgresql://another-project.example.com/app' },
      { dbPort: 5150, webPort: 5200, serverPort: 5100 },
    );

    assert.equal(env.DATABASE_MODE, 'compose');
    assert.equal(env.DATABASE_URL, 'postgresql://postgres:postgres@127.0.0.1:5150/postgres');
  });

  it('preserves a valid URL only in explicit external mode', () => {
    const databaseUrl = 'postgresql://user:secret@database.example.com:6543/app';
    const env = resolveManagedEnv(
      { DATABASE_MODE: 'external', DATABASE_URL: databaseUrl },
      { dbPort: 5150, webPort: 5200, serverPort: 5100 },
    );

    assert.equal(env.DATABASE_MODE, 'external');
    assert.equal(env.DATABASE_URL, databaseUrl);
    assert.equal(env.DB_PORT, '5150');
  });

  it('rejects invalid modes and invalid external URLs', () => {
    const ports = { dbPort: 5150, webPort: 5200, serverPort: 5100 };
    assert.throws(
      () => resolveManagedEnv({ DATABASE_MODE: 'local' }, ports),
      /Invalid DATABASE_MODE/,
    );
    assert.throws(
      () => resolveManagedEnv({ DATABASE_MODE: 'external', DATABASE_URL: 'not-a-url' }, ports),
      /valid PostgreSQL URL/,
    );
  });
});
