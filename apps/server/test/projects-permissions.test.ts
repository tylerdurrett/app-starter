import { describe, it, expect } from 'vitest';
import { can, type ProjectRole } from '../src/projects/permissions.js';

describe('Project Permissions', () => {
  describe('owner role', () => {
    const role: ProjectRole = 'owner';

    it('can read project', () => {
      expect(can(role, 'project:read')).toBe(true);
    });

    it('can edit project', () => {
      expect(can(role, 'project:edit')).toBe(true);
    });

    it('can delete project', () => {
      expect(can(role, 'project:delete')).toBe(true);
    });

    it('can list members', () => {
      expect(can(role, 'project:members:list')).toBe(true);
    });

    it('can invite members', () => {
      expect(can(role, 'project:members:invite')).toBe(true);
    });

    it('can remove members', () => {
      expect(can(role, 'project:members:remove')).toBe(true);
    });

    it('can list invites', () => {
      expect(can(role, 'project:invites:list')).toBe(true);
    });

    it('can revoke invites', () => {
      expect(can(role, 'project:invites:revoke')).toBe(true);
    });
  });

  describe('manager role', () => {
    const role: ProjectRole = 'manager';

    it('can read project', () => {
      expect(can(role, 'project:read')).toBe(true);
    });

    it('can edit project', () => {
      expect(can(role, 'project:edit')).toBe(true);
    });

    it('CANNOT delete project', () => {
      expect(can(role, 'project:delete')).toBe(false);
    });

    it('can list members', () => {
      expect(can(role, 'project:members:list')).toBe(true);
    });

    it('can invite members', () => {
      expect(can(role, 'project:members:invite')).toBe(true);
    });

    it('can remove members', () => {
      expect(can(role, 'project:members:remove')).toBe(true);
    });

    it('can list invites', () => {
      expect(can(role, 'project:invites:list')).toBe(true);
    });

    it('can revoke invites', () => {
      expect(can(role, 'project:invites:revoke')).toBe(true);
    });
  });

  describe('member role', () => {
    const role: ProjectRole = 'member';

    it('can read project', () => {
      expect(can(role, 'project:read')).toBe(true);
    });

    it('CANNOT edit project', () => {
      expect(can(role, 'project:edit')).toBe(false);
    });

    it('CANNOT delete project', () => {
      expect(can(role, 'project:delete')).toBe(false);
    });

    it('can list members', () => {
      expect(can(role, 'project:members:list')).toBe(true);
    });

    it('CANNOT invite members', () => {
      expect(can(role, 'project:members:invite')).toBe(false);
    });

    it('CANNOT remove members', () => {
      expect(can(role, 'project:members:remove')).toBe(false);
    });

    it('can list invites', () => {
      expect(can(role, 'project:invites:list')).toBe(true);
    });

    it('CANNOT revoke invites', () => {
      expect(can(role, 'project:invites:revoke')).toBe(false);
    });
  });
});
