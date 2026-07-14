import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import {
  buildComposeCommand,
  canonicalCheckoutRoot,
  composeProjectName,
  runCompose,
} from './compose.mjs';

function temporaryCheckouts() {
  const parent = mkdtempSync(join(tmpdir(), 'app-starter-compose-'));
  const first = join(parent, 'first');
  const second = join(parent, 'second');
  const alias = join(parent, 'first-alias');
  mkdirSync(first);
  mkdirSync(second);
  symlinkSync(first, alias, 'dir');
  return { first, second, alias };
}

describe('Compose project identity', () => {
  it('is stable for a checkout and valid for Docker Compose', () => {
    const { first } = temporaryCheckouts();
    const projectName = composeProjectName(first);
    const expectedHash = createHash('sha256')
      .update(canonicalCheckoutRoot(first))
      .digest('hex')
      .slice(0, 12);

    assert.equal(composeProjectName(first), projectName);
    assert.match(projectName, /^[a-z0-9][a-z0-9_-]+$/);
    assert.equal(projectName, `app-starter-${expectedHash}`);
  });

  it('differs between checkout roots', () => {
    const { first, second } = temporaryCheckouts();
    assert.notEqual(composeProjectName(first), composeProjectName(second));
  });

  it('treats a symlink and its canonical checkout as the same project', () => {
    const { first, alias } = temporaryCheckouts();
    assert.equal(canonicalCheckoutRoot(alias), canonicalCheckoutRoot(first));
    assert.equal(composeProjectName(alias), composeProjectName(first));
  });
});

describe('Compose commands', () => {
  it('places the checkout namespace on every invocation', () => {
    const { first } = temporaryCheckouts();
    assert.deepEqual(buildComposeCommand(['up', '-d'], { checkoutRoot: first }), {
      command: 'docker',
      args: ['compose', '--project-name', composeProjectName(first), 'up', '-d'],
      cwd: canonicalCheckoutRoot(first),
    });
  });

  it('executes the constructed command and options', async () => {
    const { first } = temporaryCheckouts();
    const calls = [];
    const env = { DB_PORT: '6150' };

    await runCompose(['down', '-v'], {
      checkoutRoot: first,
      env,
      stdio: 'ignore',
      spawnCommand(command, args, options) {
        calls.push({ command, args, options });
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('close', 0, null));
        return child;
      },
    });

    assert.deepEqual(calls, [
      {
        command: 'docker',
        args: ['compose', '--project-name', composeProjectName(first), 'down', '-v'],
        options: { cwd: canonicalCheckoutRoot(first), env, stdio: 'ignore' },
      },
    ]);
  });
});

const composeVersion = spawnSync('docker', ['compose', 'version'], {
  encoding: 'utf8',
  stdio: 'pipe',
});
const hasDockerCompose = composeVersion.status === 0;

it(
  'defines a valid namespaced Compose project without a fixed container name',
  { skip: !hasDockerCompose },
  () => {
    const command = buildComposeCommand(['config'], {
      checkoutRoot: new URL('..', import.meta.url),
    });
    const result = spawnSync(command.command, command.args, {
      cwd: command.cwd,
      env: { ...process.env, DB_PORT: '6150' },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /(?:^|\n)\s*container_name:/);
    assert.doesNotMatch(result.stdout, /app-starter-postgres/);
    assert.match(result.stdout, /healthcheck:/);
  },
);
