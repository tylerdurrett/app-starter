import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, '../../project.config.json');
const repoRoot = resolve(__dirname, '../..');
const envPath = resolve(repoRoot, '.env');

// Read webPort from project.config.json
let webPort = 5200; // default
try {
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  if (config.webPort) {
    webPort = config.webPort;
  }
} catch {
  // Will use default port if config doesn't exist yet
}

function readAllowedHosts() {
  try {
    const env = readFileSync(envPath, 'utf-8');
    const line = env.split('\n').find((entry) => entry.startsWith('VITE_ALLOWED_HOSTS='));
    if (!line) return [];
    return line
      .slice('VITE_ALLOWED_HOSTS='.length)
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export default defineConfig({
  // Load .env from repo root so VITE_* vars live alongside server env
  envDir: repoRoot,
  plugins: [TanStackRouterVite(), react(), tailwindcss()],
  server: {
    port: webPort,
    // Bind/print `localhost` (not 127.0.0.1) so the dev URL matches the origin
    // the rest of the stack is keyed to (CORS_ORIGIN, BETTER_AUTH_URL, auth
    // cookies all use localhost). Browsers treat localhost and 127.0.0.1 as
    // distinct origins, so serving on 127.0.0.1 made auth fetches fail CORS
    // ("Failed to fetch" on sign-in). localhost still binds loopback only.
    host: 'localhost',
    strictPort: true,
    // Tailscale dev access uses MagicDNS hostnames; Vite blocks unknown hosts
    // by default to prevent DNS rebinding.
    allowedHosts: readAllowedHosts(),
  },
});
