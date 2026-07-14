#!/usr/bin/env node

/**
 * Port detection + project.config.json + .env generation.
 *
 * Usage:
 *   node scripts/setup.mjs            # interactive — prompts in a TTY
 *   node scripts/setup.mjs --ensure   # non-interactive — reuse or auto-pick
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { parseEnvironmentFile, resolveDatabaseEnvironment } from './database-env.mjs';
import { findFreePort, isPortAvailable } from './port-availability.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const configPath = resolve(repoRoot, 'project.config.json');
const envPath = resolve(repoRoot, '.env');

const SERVER_PORT_START = 5100;
const SERVER_PORT_END = 5149;
const DB_PORT_START = 5150;
const DB_PORT_END = 5199;
const WEB_PORT_START = 5200;
const WEB_PORT_END = 5249;

const ensureMode = process.argv.includes('--ensure');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read an existing project.config.json, or null if missing / invalid. */
function readConfig() {
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    // Return the parsed config with all available ports
    return {
      serverPort: parsed.serverPort ?? null,
      dbPort: parsed.dbPort ?? null,
      webPort: parsed.webPort ?? null,
    };
  } catch {
    return null;
  }
}

/** Write project.config.json with the chosen ports. */
function writeConfig(serverPort, dbPort, webPort) {
  const data = { serverPort, dbPort, webPort };
  writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n');
  console.log(`Wrote ${configPath}`);
  console.log(`  serverPort: ${serverPort}`);
  console.log(`  dbPort:     ${dbPort}`);
  console.log(`  webPort:    ${webPort}`);
}

/** Read existing .env file and parse into key-value pairs */
function readEnvFile() {
  try {
    return parseEnvironmentFile(readFileSync(envPath));
  } catch {
    return {};
  }
}

/** Generate a random secret for Better Auth */
function generateAuthSecret() {
  // Cryptographically secure — equivalent to `openssl rand -base64 32`.
  return randomBytes(32).toString('base64');
}

/** Generate a random encryption key for credentials */
function generateEncryptionKey() {
  // Cryptographically secure — equivalent to `openssl rand -hex 32`.
  return randomBytes(32).toString('hex');
}

function isLocalDevUrl(value, path = '/') {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      (url.pathname === path || url.pathname === `${path}/`)
    );
  } catch {
    return false;
  }
}

/** Upsert .env values - preserve existing, update/add generated ones */
export function resolveManagedEnv(existing, { dbPort, webPort, serverPort }) {
  const database = resolveDatabaseEnvironment({
    config: { dbPort },
    fileEnv: existing,
    inheritedEnv: {},
  });
  const localAuthUrl = `http://localhost:${serverPort}`;
  const localWebUrl = `http://localhost:${webPort}`;
  const authUrl =
    existing.BETTER_AUTH_URL && !isLocalDevUrl(existing.BETTER_AUTH_URL)
      ? existing.BETTER_AUTH_URL.replace(/\/$/, '')
      : localAuthUrl;
  const webUrl =
    existing.CORS_ORIGIN && !isLocalDevUrl(existing.CORS_ORIGIN)
      ? existing.CORS_ORIGIN.replace(/\/$/, '')
      : localWebUrl;
  const viteServerUrl =
    existing.VITE_SERVER_URL && !isLocalDevUrl(existing.VITE_SERVER_URL)
      ? existing.VITE_SERVER_URL.replace(/\/$/, '')
      : authUrl;
  const mcpUrl =
    existing.MCP_CANONICAL_URL && !isLocalDevUrl(existing.MCP_CANONICAL_URL, '/mcp')
      ? existing.MCP_CANONICAL_URL.replace(/\/$/, '')
      : `${authUrl}/mcp`;

  return {
    DB_PORT: String(dbPort),
    DATABASE_MODE: database.mode,
    DATABASE_URL: database.databaseUrl,
    // Preserve custom HTTPS origins used by Tailscale Serve or production-like
    // local testing. Overwriting them during `pnpm go` breaks CORS/cookie auth.
    CORS_ORIGIN: webUrl,
    VITE_SERVER_URL: viteServerUrl,
    BETTER_AUTH_URL: authUrl,
    MCP_CANONICAL_URL: mcpUrl,
    AUTH_REQUIRE_EMAIL_VERIFICATION: existing.AUTH_REQUIRE_EMAIL_VERIFICATION ?? 'false',
  };
}

function writeEnvFile(dbPort, webPort, serverPort) {
  const existing = readEnvFile();

  // Generated values that we manage
  const managed = resolveManagedEnv(existing, { dbPort, webPort, serverPort });

  // Add BETTER_AUTH_SECRET if it doesn't exist
  if (!existing.BETTER_AUTH_SECRET) {
    managed.BETTER_AUTH_SECRET = generateAuthSecret();
  }

  // Add CREDENTIAL_ENCRYPTION_KEY if it doesn't exist
  if (!existing.CREDENTIAL_ENCRYPTION_KEY) {
    managed.CREDENTIAL_ENCRYPTION_KEY = generateEncryptionKey();
    console.log('Generated CREDENTIAL_ENCRYPTION_KEY (stored in .env)');
  }

  // Merge with existing, managed values take precedence
  const final = { ...existing, ...managed };

  // Write back to file
  const content =
    Object.entries(final)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n';

  writeFileSync(envPath, content);
  console.log(`Updated ${envPath}`);
}

/** Prompt the user for a line of input. */
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(question, (answer) => {
      rl.close();
      res(answer.trim());
    });
  });
}

/** Prompt for a port, validate, and return the chosen value. */
export async function askPort(
  label,
  defaultPort,
  { askFn = ask, isPortAvailableFn = isPortAvailable, reportError = console.error } = {},
) {
  while (true) {
    const answer = await askFn(`${label} port [${defaultPort}]: `);
    const chosen = answer === '' ? defaultPort : Number(answer);
    if (!Number.isInteger(chosen) || chosen < 1 || chosen > 65535) {
      reportError(`Invalid port: "${answer}"`);
      continue;
    }
    if (!(await isPortAvailableFn(chosen))) {
      reportError(`Port ${chosen} is already in use or unavailable.`);
      continue;
    }
    return chosen;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Find a free port in a range or exit with an error. */
async function requireFreePort(start, end, label) {
  const port = await findFreePort(start, end);
  if (port === null) {
    console.error(`No free ${label} port found in range ${start}–${end}.`);
    process.exit(1);
  }
  return port;
}

async function main() {
  const existing = readConfig();

  // Non-interactive path: --ensure flag or piped stdin
  if (ensureMode || !process.stdin.isTTY) {
    if (existing && existing.serverPort && existing.dbPort && existing.webPort) {
      console.log(
        `project.config.json exists (server ${existing.serverPort}, db ${existing.dbPort}, web ${existing.webPort}) — reusing.`,
      );
      // Always regenerate .env to stay in sync
      writeEnvFile(existing.dbPort, existing.webPort, existing.serverPort);
      return;
    }
    const serverPort =
      existing?.serverPort ?? (await requireFreePort(SERVER_PORT_START, SERVER_PORT_END, 'server'));
    const dbPort =
      existing?.dbPort ?? (await requireFreePort(DB_PORT_START, DB_PORT_END, 'database'));
    const webPort =
      existing?.webPort ?? (await requireFreePort(WEB_PORT_START, WEB_PORT_END, 'web'));
    writeConfig(serverPort, dbPort, webPort);
    writeEnvFile(dbPort, webPort, serverPort);
    return;
  }

  // Interactive TTY flow
  if (existing && existing.serverPort && existing.dbPort && existing.webPort) {
    console.log(
      `Current config: serverPort = ${existing.serverPort}, dbPort = ${existing.dbPort}, webPort = ${existing.webPort}`,
    );
  }

  const defaultServerPort =
    existing?.serverPort ?? (await requireFreePort(SERVER_PORT_START, SERVER_PORT_END, 'server'));
  const chosenServer = await askPort('Server', defaultServerPort);

  const defaultDbPort =
    existing?.dbPort ?? (await requireFreePort(DB_PORT_START, DB_PORT_END, 'database'));
  const chosenDb = await askPort('Database', defaultDbPort);

  const defaultWebPort =
    existing?.webPort ?? (await requireFreePort(WEB_PORT_START, WEB_PORT_END, 'web'));
  const chosenWeb = await askPort('Web', defaultWebPort);

  writeConfig(chosenServer, chosenDb, chosenWeb);
  writeEnvFile(chosenDb, chosenWeb, chosenServer);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
