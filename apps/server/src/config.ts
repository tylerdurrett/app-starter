import { config as loadEnv } from 'dotenv';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');

// Load .env from repo root so DATABASE_URL is available to downstream imports
loadEnv({ path: resolve(repoRoot, '.env') });

interface ProjectConfig {
  serverPort?: number;
  dbPort?: number;
  webPort?: number;
}

function loadProjectConfig(): ProjectConfig {
  try {
    const raw = readFileSync(resolve(repoRoot, 'project.config.json'), 'utf-8');
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return {};
  }
}

const projectConfig = loadProjectConfig();

const nodeEnv = process.env.NODE_ENV;
const isProduction = nodeEnv === 'production';

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function parseStrictBoolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be either "true" or "false"`);
}

const TRUST_PROXY_ALIASES = new Set(['loopback', 'linklocal', 'uniquelocal']);
const TRUST_PROXY_ERROR =
  'TRUST_PROXY must be "false", a canonical positive integer, or a comma-separated list of IP addresses, CIDR ranges, and supported aliases (loopback, linklocal, uniquelocal)';

function isCanonicalPositiveInteger(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

function isValidProxyAddress(value: string): boolean {
  const slashIndex = value.indexOf('/');
  if (slashIndex === -1) return isIP(value) !== 0;
  if (slashIndex !== value.lastIndexOf('/')) return false;

  const address = value.slice(0, slashIndex);
  const prefix = value.slice(slashIndex + 1);
  const family = isIP(address);
  if (family === 0 || !isCanonicalPositiveInteger(prefix)) return false;

  return Number(prefix) <= (family === 4 ? 32 : 128);
}

export type TrustProxyPolicy = false | number | string[];

function parseTrustProxy(raw: string | undefined): TrustProxyPolicy {
  const value = raw?.trim();
  if (!value || value === 'false') return false;

  if (/^[1-9]\d*$/.test(value)) {
    const hops = Number(value);
    if (Number.isSafeInteger(hops)) return hops;
    throw new Error(TRUST_PROXY_ERROR);
  }

  const entries = value.split(',').map((entry) => entry.trim());
  if (
    entries.some((entry) => !entry) ||
    entries.some((entry) => !TRUST_PROXY_ALIASES.has(entry) && !isValidProxyAddress(entry))
  ) {
    throw new Error(TRUST_PROXY_ERROR);
  }

  return entries;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const unbracketedHost = host.replace(/^\[/, '').replace(/\]$/, '');
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    unbracketedHost === '::1' ||
    host.startsWith('127.')
  ) {
    return true;
  }

  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match) {
    const octets = match.slice(1).map(Number) as [number, number, number, number];
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return false;
    }
    const [a, b] = octets;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  return (
    unbracketedHost.includes(':') &&
    (unbracketedHost.startsWith('fc') || unbracketedHost.startsWith('fd'))
  );
}

function normalizeUrl(
  name: string,
  raw: string | undefined,
  fallback: string | undefined,
  opts: { originOnly?: boolean } = {},
): string {
  const value = raw || fallback;
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must start with http:// or https://`);
  }
  if (isProduction) {
    if (url.protocol !== 'https:') {
      throw new Error(`${name} must use https:// in production`);
    }
    if (isPrivateHost(url.hostname)) {
      throw new Error(`${name} must not point at localhost or a private host in production`);
    }
  }
  if (opts.originOnly && (url.pathname !== '/' || url.search || url.hash)) {
    throw new Error(`${name} must be an origin without a path, query, or hash`);
  }
  if (url.search || url.hash) {
    throw new Error(`${name} must not include a query string or hash`);
  }

  return url.toString().replace(/\/+$/, '');
}

// Validate CREDENTIAL_ENCRYPTION_KEY
const credentialEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
if (!credentialEncryptionKey) {
  throw new Error('CREDENTIAL_ENCRYPTION_KEY environment variable is required');
}
if (!/^[0-9a-fA-F]{64}$/.test(credentialEncryptionKey)) {
  throw new Error('CREDENTIAL_ENCRYPTION_KEY must be exactly 64 hex characters');
}

const defaultServerPort = projectConfig.serverPort ?? 5100;
const defaultWebPort = projectConfig.webPort ?? 5200;
const port = parsePort(process.env.PORT, defaultServerPort);
const apiOrigin = normalizeUrl(
  'BETTER_AUTH_URL',
  process.env.BETTER_AUTH_URL,
  isProduction ? undefined : `http://localhost:${defaultServerPort}`,
  { originOnly: true },
);
const webOrigin = normalizeUrl(
  'CORS_ORIGIN',
  process.env.CORS_ORIGIN,
  isProduction ? undefined : `http://localhost:${defaultWebPort}`,
  { originOnly: true },
);
const mcpCanonicalUrl = normalizeUrl(
  'MCP_CANONICAL_URL',
  process.env.MCP_CANONICAL_URL,
  isProduction ? undefined : `${apiOrigin}/mcp`,
);
const authRequireEmailVerification = parseStrictBoolean(
  'AUTH_REQUIRE_EMAIL_VERIFICATION',
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION,
  isProduction,
);
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

if (isProduction && authRequireEmailVerification) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable is required when email verification is enabled in production');
  }
  if (!process.env.EMAIL_FROM) {
    throw new Error('EMAIL_FROM environment variable is required when email verification is enabled in production');
  }
}

export const config = {
  port,
  host: '0.0.0.0',
  webOrigin,
  credentialEncryptionKey,
  apiOrigin,
  mcpCanonicalUrl,
  authRequireEmailVerification,
  trustProxy,
} as const;
