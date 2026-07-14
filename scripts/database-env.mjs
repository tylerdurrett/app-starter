import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

function definedEntries(env) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}

export function parseEnvironmentFile(contents) {
  return parse(contents);
}

function readEnvFile(path) {
  try {
    return parseEnvironmentFile(readFileSync(path));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function requireDbPort(config) {
  const port = config?.dbPort;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dbPort must be an integer between 1 and 65535 in project.config.json');
  }
  return port;
}

function readProjectConfig(repoRoot) {
  try {
    return JSON.parse(readFileSync(resolve(repoRoot, 'project.config.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Missing project.config.json — run `pnpm hello` first.', { cause: error });
    }
    throw error;
  }
}

export function composeDatabaseUrl(dbPort) {
  return `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres`;
}

export function parseDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('DATABASE_MODE=external requires an explicit DATABASE_URL.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    // URL errors include the original input, which may contain credentials.
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!POSTGRES_PROTOCOLS.has(url.protocol) || !url.hostname) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  const port = url.port === '' ? 5432 : Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DATABASE_URL must use a port between 1 and 65535.');
  }

  return {
    hostname: url.hostname,
    port,
  };
}

/**
 * Resolve the single database policy and child environment used by database
 * readiness, migrations, and any process started after them.
 */
export function resolveDatabaseEnvironment({
  repoRoot = defaultRepoRoot,
  config,
  fileEnv,
  inheritedEnv = process.env,
  childEnvOverrides = {},
} = {}) {
  const environment = {
    ...(fileEnv ?? readEnvFile(resolve(repoRoot, '.env'))),
    ...definedEntries(inheritedEnv),
    ...definedEntries(childEnvOverrides),
  };
  const mode = environment.DATABASE_MODE ?? 'compose';

  if (mode !== 'compose' && mode !== 'external') {
    throw new Error('Invalid DATABASE_MODE; expected "compose" or "external".');
  }

  let databaseUrl;
  let hostname;
  let port;
  if (mode === 'compose') {
    const dbPort = requireDbPort(config ?? readProjectConfig(repoRoot));
    databaseUrl = composeDatabaseUrl(dbPort);
    hostname = '127.0.0.1';
    port = dbPort;
  } else {
    databaseUrl = environment.DATABASE_URL;
    ({ hostname, port } = parseDatabaseUrl(databaseUrl));
  }

  const childEnv = Object.freeze({
    ...environment,
    DATABASE_MODE: mode,
    DATABASE_URL: databaseUrl,
    DB_PORT: String(port),
  });

  return Object.freeze({ mode, databaseUrl, hostname, port, childEnv });
}
