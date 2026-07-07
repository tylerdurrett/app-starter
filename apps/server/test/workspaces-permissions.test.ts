import { describe, it, expect } from 'vitest';
import { can, type WorkspaceRole } from '../src/workspaces/permissions.js';

describe('Workspace Permissions', () => {
  describe('owner role', () => {
    const role: WorkspaceRole = 'owner';

    it('can read workspace', () => {
      expect(can(role, 'workspace:read')).toBe(true);
    });

    it('can edit workspace', () => {
      expect(can(role, 'workspace:edit')).toBe(true);
    });

    it('can delete workspace', () => {
      expect(can(role, 'workspace:delete')).toBe(true);
    });

    it('can list members', () => {
      expect(can(role, 'workspace:members:list')).toBe(true);
    });

    it('can invite members', () => {
      expect(can(role, 'workspace:members:invite')).toBe(true);
    });

    it('can remove members', () => {
      expect(can(role, 'workspace:members:remove')).toBe(true);
    });

    it('can list invites', () => {
      expect(can(role, 'workspace:invites:list')).toBe(true);
    });

    it('can revoke invites', () => {
      expect(can(role, 'workspace:invites:revoke')).toBe(true);
    });

    it('can create projects', () => {
      expect(can(role, 'projects:create')).toBe(true);
    });
  });

  describe('manager role', () => {
    const role: WorkspaceRole = 'manager';

    it('can read workspace', () => {
      expect(can(role, 'workspace:read')).toBe(true);
    });

    it('can edit workspace', () => {
      expect(can(role, 'workspace:edit')).toBe(true);
    });

    it('CANNOT delete workspace', () => {
      expect(can(role, 'workspace:delete')).toBe(false);
    });

    it('can list members', () => {
      expect(can(role, 'workspace:members:list')).toBe(true);
    });

    it('can invite members', () => {
      expect(can(role, 'workspace:members:invite')).toBe(true);
    });

    it('can remove members', () => {
      expect(can(role, 'workspace:members:remove')).toBe(true);
    });

    it('can list invites', () => {
      expect(can(role, 'workspace:invites:list')).toBe(true);
    });

    it('can revoke invites', () => {
      expect(can(role, 'workspace:invites:revoke')).toBe(true);
    });

    it('can create projects', () => {
      expect(can(role, 'projects:create')).toBe(true);
    });
  });

  describe('member role', () => {
    const role: WorkspaceRole = 'member';

    it('can read workspace', () => {
      expect(can(role, 'workspace:read')).toBe(true);
    });

    it('CANNOT edit workspace', () => {
      expect(can(role, 'workspace:edit')).toBe(false);
    });

    it('CANNOT delete workspace', () => {
      expect(can(role, 'workspace:delete')).toBe(false);
    });

    it('can list members', () => {
      expect(can(role, 'workspace:members:list')).toBe(true);
    });

    it('CANNOT invite members', () => {
      expect(can(role, 'workspace:members:invite')).toBe(false);
    });

    it('CANNOT remove members', () => {
      expect(can(role, 'workspace:members:remove')).toBe(false);
    });

    it('can list invites', () => {
      expect(can(role, 'workspace:invites:list')).toBe(true);
    });

    it('CANNOT revoke invites', () => {
      expect(can(role, 'workspace:invites:revoke')).toBe(false);
    });

    it('can create projects', () => {
      expect(can(role, 'projects:create')).toBe(true);
    });
  });
});