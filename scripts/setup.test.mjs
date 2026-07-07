import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveManagedEnv } from './setup.mjs';

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
});
