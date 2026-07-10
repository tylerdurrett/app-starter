import { describe, expect, it } from 'vitest';
import { parseProjectSlug, parseWorkspaceSlug } from './active-workspace';

describe('parseWorkspaceSlug', () => {
  it('resolves the workspace slug from a nested workspace path', () => {
    expect(parseWorkspaceSlug('/w/acme')).toBe('acme');
  });

  it('resolves the workspace slug from a nested project path', () => {
    expect(parseWorkspaceSlug('/w/acme/p/proj')).toBe('acme');
  });

  it('resolves the workspace slug from deeper nested paths (settings)', () => {
    expect(parseWorkspaceSlug('/w/acme/p/proj/settings')).toBe('acme');
  });

  it('returns null for the legacy flat project path', () => {
    expect(parseWorkspaceSlug('/p/proj')).toBeNull();
  });

  it('returns null for unrelated paths', () => {
    expect(parseWorkspaceSlug('/onboarding/create-workspace')).toBeNull();
    expect(parseWorkspaceSlug('/')).toBeNull();
  });
});

describe('parseProjectSlug', () => {
  it('resolves the project slug from a nested project path', () => {
    expect(parseProjectSlug('/w/acme/p/proj')).toBe('proj');
  });

  it('resolves the project slug from deeper nested paths (settings)', () => {
    expect(parseProjectSlug('/w/acme/p/proj/settings')).toBe('proj');
  });

  it('yields no project match for the legacy flat /p/:slug shape', () => {
    // Proves flat routes no longer resolve at the parse layer (ADR-0009).
    expect(parseProjectSlug('/p/proj')).toBeNull();
  });

  it('yields no project match for a workspace-only path', () => {
    expect(parseProjectSlug('/w/acme')).toBeNull();
  });

  it('returns null for unrelated paths', () => {
    expect(parseProjectSlug('/onboarding/create-workspace')).toBeNull();
  });
});
