import { describe, expect, it } from 'vitest';
import { queryKeys } from './query-keys';

// The query-key factory is the single source of query keys for the slice.
// These tests pin the exact tuple each factory produces so a drift in shape
// or scoping fails loudly, and any converted page reading/invalidating the
// same key stays in agreement.
describe('queryKeys factory', () => {
  it('re-keys the MCP connector query as ["me", "mcp-connector"]', () => {
    expect(queryKeys.mcpConnector()).toEqual(['me', 'mcp-connector']);
  });

  describe('workspaces', () => {
    it('produces the workspace list key', () => {
      expect(queryKeys.workspaces()).toEqual(['workspaces']);
    });

    it('scopes a workspace detail by slug', () => {
      expect(queryKeys.workspace('acme')).toEqual(['workspace', 'acme']);
    });

    it('scopes workspace members by slug under the workspace detail', () => {
      expect(queryKeys.workspaceMembers('acme')).toEqual(['workspace', 'acme', 'members']);
    });

    it('scopes workspace invites by slug under the workspace detail', () => {
      expect(queryKeys.workspaceInvites('acme')).toEqual(['workspace', 'acme', 'invites']);
    });

    it('gives distinct keys for distinct slugs', () => {
      expect(queryKeys.workspace('acme')).not.toEqual(queryKeys.workspace('other'));
    });

    it('keeps the plural list key from being a prefix of a workspace detail', () => {
      // Distinct root tokens ('workspaces' vs 'workspace') so invalidating the
      // list never cascades into an individual workspace detail.
      expect(queryKeys.workspaces()[0]).not.toBe(queryKeys.workspace('acme')[0]);
    });
  });

  describe('projects', () => {
    it('scopes the plural project list by workspace slug', () => {
      expect(queryKeys.projects('acme')).toEqual(['projects', 'acme']);
    });

    it('keeps the global accessible-project list distinct from every workspace list', () => {
      expect(queryKeys.accessibleProjects()).toEqual(['accessible-projects']);
      expect(queryKeys.accessibleProjects()).not.toEqual(queryKeys.projects('accessible-projects'));
    });

    it('scopes a singular project detail by workspace slug and project slug', () => {
      expect(queryKeys.project('acme', 'web')).toEqual(['project', 'acme', 'web']);
    });

    it('scopes project members by workspace and project slug under the detail', () => {
      expect(queryKeys.projectMembers('acme', 'web')).toEqual([
        'project',
        'acme',
        'web',
        'members',
      ]);
    });

    it('scopes project invites by workspace and project slug under the detail', () => {
      expect(queryKeys.projectInvites('acme', 'web')).toEqual([
        'project',
        'acme',
        'web',
        'invites',
      ]);
    });

    it('keeps the plural list key from being a prefix of a project detail', () => {
      expect(queryKeys.projects('acme')[0]).not.toBe(queryKeys.project('acme', 'web')[0]);
    });

    it('scopes projects to their workspace so sibling workspaces do not collide', () => {
      expect(queryKeys.project('acme', 'web')).not.toEqual(queryKeys.project('other', 'web'));
    });

    it('nests each last-active validation under the base key and its full hint', () => {
      const hint = { workspaceSlug: 'acme', projectSlug: 'web', projectId: 'project-1' };

      expect(queryKeys.lastActiveProject()).toEqual(['last-active-project']);
      expect(queryKeys.lastActiveProjectValidation(hint)).toEqual([
        'last-active-project',
        'validation',
        'acme',
        'web',
        'project-1',
      ]);
      expect(queryKeys.lastActiveProjectValidation(hint).slice(0, 1)).toEqual(
        queryKeys.lastActiveProject(),
      );
    });

    it('does not share validation keys between coherent hints', () => {
      const projectA = { workspaceSlug: 'acme', projectSlug: 'web', projectId: 'project-a' };
      const projectB = { workspaceSlug: 'acme', projectSlug: 'web', projectId: 'project-b' };

      expect(queryKeys.lastActiveProjectValidation(projectA)).not.toEqual(
        queryKeys.lastActiveProjectValidation(projectB),
      );
    });
  });

  describe('integrations', () => {
    it('scopes the plural integration list by workspace slug', () => {
      expect(queryKeys.integrations('acme')).toEqual(['integrations', 'acme']);
    });

    it('scopes a singular integration detail by workspace slug and integration id', () => {
      expect(queryKeys.integration('acme', 'int-1')).toEqual(['integration', 'acme', 'int-1']);
    });

    it('keeps the plural list key from being a prefix of an integration detail', () => {
      expect(queryKeys.integrations('acme')[0]).not.toBe(queryKeys.integration('acme', 'int-1')[0]);
    });

    it('gives distinct keys for distinct integration ids', () => {
      expect(queryKeys.integration('acme', 'int-1')).not.toEqual(
        queryKeys.integration('acme', 'int-2'),
      );
    });
  });

  describe('oauthClient', () => {
    it('scopes the consent client-info key by client id', () => {
      expect(queryKeys.oauthClient('client-123')).toEqual(['oauth-client', 'client-123']);
    });

    it('gives distinct keys for distinct client ids', () => {
      expect(queryKeys.oauthClient('a')).not.toEqual(queryKeys.oauthClient('b'));
    });
  });
});
