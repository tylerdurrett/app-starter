import { createServer } from 'node:net';

export const PORT_PROBE_HOSTS = ['0.0.0.0', '127.0.0.1', '::', '::1'];

const UNAVAILABLE_CODES = new Set(['EADDRINUSE', 'EACCES']);
const UNSUPPORTED_INTERFACE_CODES = new Set(['EAFNOSUPPORT', 'EADDRNOTAVAIL']);

function closeServer(server) {
  return new Promise((resolve, reject) => {
    try {
      server.close((error) => {
        if (!error || error.code === 'ERR_SERVER_NOT_RUNNING') {
          resolve();
          return;
        }
        reject(error);
      });
    } catch (error) {
      if (error.code === 'ERR_SERVER_NOT_RUNNING') {
        resolve();
        return;
      }
      reject(error);
    }
  });
}

async function probeHost(port, host, createServerFn) {
  const server = createServerFn();
  server.unref?.();

  let result;
  try {
    result = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ port, host, exclusive: true }, () => resolve('available'));
    });
  } catch (error) {
    if (UNAVAILABLE_CODES.has(error.code)) {
      result = 'unavailable';
    } else if (UNSUPPORTED_INTERFACE_CODES.has(error.code)) {
      result = 'skipped';
    } else {
      result = error;
    }
  }

  await closeServer(server);

  if (result !== 'available' && result !== 'unavailable' && result !== 'skipped') throw result;
  return result;
}

/**
 * Check every local bind shape used by the development services.
 * Unsupported address families/interfaces are ignored; conflicts are not.
 */
export async function isPortAvailable(port, { createServerFn = createServer } = {}) {
  let available = true;
  let unexpectedError;

  // These probes must be sequential: simultaneous wildcard and loopback binds
  // would collide with one another and make a free port look occupied.
  for (const host of PORT_PROBE_HOSTS) {
    try {
      const result = await probeHost(port, host, createServerFn);
      if (result === 'unavailable') available = false;
    } catch (error) {
      unexpectedError ??= error;
    }
  }

  if (unexpectedError) throw unexpectedError;
  return available;
}

/** Find the first available port in the inclusive range, or null. */
export async function findFreePort(start, end, options) {
  for (let port = start; port <= end; port++) {
    if (await isPortAvailable(port, options)) return port;
  }
  return null;
}
