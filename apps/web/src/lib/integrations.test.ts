import { afterEach, describe, expect, it, vi } from 'vitest';
import { maskedIntegrationSchema, testIntegrationResultSchema } from '@repo/shared';

// Well-formed reference payloads matching the shared API contract.
const validIntegration = {
  id: 'int1',
  workspaceId: 'w1',
  type: 'slack',
  name: 'My Slack',
  status: 'active',
  config: { channel: '#general' },
  credentialsReadable: true,
  lastTestedAt: '2026-01-01T00:00:00.000Z',
  lastTestError: null,
  createdByUserId: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const validTestResult = {
  status: 'active',
  lastTestedAt: '2026-01-01T00:00:00.000Z',
  info: { team: 'Acme' },
};

// A schema drift must fail loudly, never silently. Cover the MaskedIntegration
// shape AND the TestIntegrationResult shape so a mismatch in either surfaces.
describe('integration contract schemas', () => {
  it('accept the well-formed reference payloads', () => {
    expect(() => maskedIntegrationSchema.parse(validIntegration)).not.toThrow();
    expect(() => testIntegrationResultSchema.parse(validTestResult)).not.toThrow();
  });

  it('throws on a MaskedIntegration missing a required field', () => {
    const { credentialsReadable: _omit, ...bad } = validIntegration;
    expect(() => maskedIntegrationSchema.parse(bad)).toThrow();
  });

  it('throws on a MaskedIntegration with an out-of-range status', () => {
    expect(() => maskedIntegrationSchema.parse({ ...validIntegration, status: 'disabled' })).toThrow();
  });

  it('throws on a MaskedIntegration with an out-of-range type', () => {
    expect(() => maskedIntegrationSchema.parse({ ...validIntegration, type: 'discord' })).toThrow();
  });

  it('throws on a TestIntegrationResult with an out-of-range status', () => {
    expect(() => testIntegrationResultSchema.parse({ ...validTestResult, status: 'disabled' })).toThrow();
  });
});

// Prove the drift throws through the real fetch boundary (apiFetchParsed), not
// just when calling the schema directly.
describe('apiFetchParsed boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function loadLibReturning(body: unknown) {
    vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => body,
      }),
    );
    vi.resetModules();
    return import('./integrations');
  }

  it('rejects when the server returns a malformed MaskedIntegration', async () => {
    const { listIntegrations } = await loadLibReturning([{ ...validIntegration, status: 'disabled' }]);
    await expect(listIntegrations('acme')).rejects.toThrow();
  });

  it('rejects when the server returns a malformed TestIntegrationResult', async () => {
    const { testIntegration } = await loadLibReturning({ ...validTestResult, status: 'disabled' });
    await expect(testIntegration('acme', 'int1')).rejects.toThrow();
  });

  it('resolves when the server returns a well-formed MaskedIntegration', async () => {
    const { getIntegration } = await loadLibReturning(validIntegration);
    await expect(getIntegration('acme', 'int1')).resolves.toMatchObject({
      id: 'int1',
      type: 'slack',
      status: 'active',
    });
  });
});
