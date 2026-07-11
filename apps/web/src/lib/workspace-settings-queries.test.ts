import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './query-keys';

// The module transitively imports ./api, which throws at load time unless
// VITE_SERVER_URL is set — mirror the repo's other lib tests and stub it before
// dynamically importing the module under test. (query-keys has no side effects,
// so it stays a static import.)
type Mod = typeof import('./workspace-settings-queries');
let mod: Mod;

beforeAll(async () => {
  vi.stubEnv('VITE_SERVER_URL', 'http://test.local');
  mod = await import('./workspace-settings-queries');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

// A stand-in QueryClient that only records invalidateQueries calls — enough to
// assert the per-write invalidation wiring in the node vitest env without a
// real client or a rendered component.
function mockQueryClient() {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  return { invalidateQueries } as unknown as QueryClient & {
    invalidateQueries: ReturnType<typeof vi.fn>;
  };
}

// The settings page reads through these factories and invalidates through the
// mutation factories. Pin the exact key each one touches so a drift in the
// query-key wiring — reads that never refetch, or a write that invalidates the
// wrong slice of cache — fails loudly here rather than as a stale UI.
describe('workspace-settings query factories', () => {
  describe('reads', () => {
    it('members query uses the shared workspaceMembers key', () => {
      expect(mod.workspaceMembersQuery('acme').queryKey).toEqual(
        queryKeys.workspaceMembers('acme'),
      );
    });

    it('invites query uses the shared workspaceInvites key', () => {
      expect(mod.workspaceInvitesQuery('acme').queryKey).toEqual(
        queryKeys.workspaceInvites('acme'),
      );
    });

    it('scopes the read keys by slug', () => {
      expect(mod.workspaceMembersQuery('acme').queryKey).not.toEqual(
        mod.workspaceMembersQuery('other').queryKey,
      );
      expect(mod.workspaceInvitesQuery('acme').queryKey).not.toEqual(
        mod.workspaceInvitesQuery('other').queryKey,
      );
    });
  });

  describe('write invalidation', () => {
    it('rename invalidates the workspace detail key', async () => {
      const client = mockQueryClient();
      await mod.renameWorkspaceMutation(client, 'acme').onSuccess();
      expect(client.invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.workspace('acme'),
      });
    });

    it('remove member invalidates the members key', async () => {
      const client = mockQueryClient();
      await mod.removeWorkspaceMemberMutation(client, 'acme').onSuccess();
      expect(client.invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.workspaceMembers('acme'),
      });
    });

    it('create invite invalidates the invites key', async () => {
      const client = mockQueryClient();
      await mod.createWorkspaceInviteMutation(client, 'acme').onSuccess();
      expect(client.invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.workspaceInvites('acme'),
      });
    });

    it('revoke invite invalidates the invites key', async () => {
      const client = mockQueryClient();
      await mod.revokeWorkspaceInviteMutation(client, 'acme').onSuccess();
      expect(client.invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.workspaceInvites('acme'),
      });
    });

    it('delete invalidates the workspaces list key so the removed workspace drops out', async () => {
      const client = mockQueryClient();
      await mod.deleteWorkspaceMutation(client, 'acme').onSuccess();
      expect(client.invalidateQueries).toHaveBeenCalledWith({
        queryKey: queryKeys.workspaces(),
      });
    });
  });
});
