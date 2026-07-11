import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { useSession } from '../lib/auth-client';
import { ApiError } from '../lib/api';
import { canProject, type ProjectRole } from '../lib/permissions';
import { resolveProject } from '../lib/project-resolver';
import {
  updateProject,
  deleteProject,
  removeProjectMember,
  createProjectInvite,
  revokeProjectInvite,
} from '../lib/projects';
import { queryKeys } from '../lib/query-keys';
import {
  projectQueryOptions,
  projectMembersQueryOptions,
  projectInvitesQueryOptions,
} from '../lib/project-queries';
import { Copy, UserMinus, X } from 'lucide-react';

const projectRoute = getRouteApi('/_app/w/$workspaceSlug/p/$projectSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/p/$projectSlug/settings')({
  component: ProjectSettingsPage,
});

function ProjectSettingsPage() {
  // Loader data is gating-derived only: workspaceSlug/slug/role don't change on
  // this page. The mutable display name is read via useQuery in each section
  // (seeded by the layout loader) so a rename refreshes live (ADR-0007).
  const { project } = projectRoute.useLoaderData();
  const { workspaceSlug, slug, role } = project;

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Settings</h1>

        <GeneralSection workspaceSlug={workspaceSlug} projectSlug={slug} role={role} />
        <MembersSection workspaceSlug={workspaceSlug} slug={slug} role={role} />
        <InvitesSection workspaceSlug={workspaceSlug} slug={slug} role={role} />
        {canProject(role, 'project:delete') && (
          <DangerZoneSection workspaceSlug={workspaceSlug} projectSlug={slug} />
        )}
      </div>
    </div>
  );
}

function GeneralSection({
  workspaceSlug,
  projectSlug,
  role,
}: {
  workspaceSlug: string;
  projectSlug: string;
  role: ProjectRole;
}) {
  const queryClient = useQueryClient();
  // Read the mutable name through the loader-seeded cache so the rename
  // invalidation below refreshes it without a page reload (ADR-0007).
  const projectQuery = useQuery(projectQueryOptions(workspaceSlug, projectSlug));
  const projectName = projectQuery.data?.name ?? '';
  const [isEditingName, setIsEditingName] = useState(false);
  const [name, setName] = useState('');

  const renameMutation = useMutation({
    mutationFn: (nextName: string) => updateProject(workspaceSlug, projectSlug, { name: nextName }),
    onSuccess: async () => {
      setIsEditingName(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.project(workspaceSlug, projectSlug) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects(workspaceSlug) }),
      ]);
    },
  });

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    renameMutation.mutate(trimmed);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-sm text-muted-foreground">Name</Label>
          {!isEditingName ? (
            <div className="flex items-center justify-between mt-1">
              <p className="text-lg">{projectName}</p>
              {canProject(role, 'project:edit') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditingName(true);
                    setName(projectName);
                    renameMutation.reset();
                  }}
                >
                  Edit
                </Button>
              )}
            </div>
          ) : (
            <form onSubmit={handleSaveName} className="mt-2 space-y-2">
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
                disabled={renameMutation.isPending}
                required
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={renameMutation.isPending || !name.trim()}>
                  {renameMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditingName(false);
                    renameMutation.reset();
                  }}
                  disabled={renameMutation.isPending}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>

        {renameMutation.isError && (
          <p className="text-sm text-destructive">Failed to update project name</p>
        )}
        {renameMutation.isSuccess && <p className="text-sm text-green-600">Name updated</p>}

        <div>
          <Label className="text-sm text-muted-foreground">Slug</Label>
          <p className="text-lg mt-1 text-muted-foreground">{projectSlug}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MembersSection({ workspaceSlug, slug, role }: { workspaceSlug: string; slug: string; role: ProjectRole }) {
  const session = useSession();
  const currentUserId = session.data?.user?.id;
  const queryClient = useQueryClient();

  const membersQuery = useQuery(projectMembersQueryOptions(workspaceSlug, slug));
  const members = membersQuery.data ?? [];

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeProjectMember(workspaceSlug, slug, userId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMembers(workspaceSlug, slug) }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent>
        {membersQuery.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {membersQuery.isError && <p className="text-sm text-destructive">Failed to load members</p>}
        {removeMutation.isError && (
          <p className="text-sm text-destructive">Failed to remove member</p>
        )}
        {!membersQuery.isLoading && !membersQuery.isError && members.length === 0 && (
          <p className="text-sm text-muted-foreground">No members found.</p>
        )}
        {!membersQuery.isLoading && members.length > 0 && (
          <ul className="divide-y divide-border">
            {members.map((member) => {
              const isCurrentUser = member.userId === currentUserId;
              return (
                <li key={member.userId} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {member.name}
                      {isCurrentUser && (
                        <span className="text-muted-foreground ml-1">(you)</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground capitalize">
                      {member.role}
                    </span>
                    {canProject(role, 'project:members:remove') && !isCurrentUser && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeMutation.mutate(member.userId)}
                        disabled={
                          removeMutation.isPending && removeMutation.variables === member.userId
                        }
                        title="Remove member"
                      >
                        <UserMinus className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InvitesSection({ workspaceSlug, slug, role }: { workspaceSlug: string; slug: string; role: ProjectRole }) {
  const queryClient = useQueryClient();

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<'manager' | 'member'>('member');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const invitesQuery = useQuery(projectInvitesQueryOptions(workspaceSlug, slug));
  const invites = invitesQuery.data ?? [];

  const invalidateInvites = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.projectInvites(workspaceSlug, slug) });

  const createMutation = useMutation({
    mutationFn: (trimmedEmail: string) =>
      createProjectInvite(workspaceSlug, slug, trimmedEmail, selectedRole),
    onSuccess: (result) => {
      setInviteUrl(result.inviteUrl);
      setEmail('');
      return invalidateInvites();
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => revokeProjectInvite(workspaceSlug, slug, inviteId),
    onSuccess: () => invalidateInvites(),
  });

  const inviteError =
    createMutation.error instanceof ApiError && createMutation.error.status === 409
      ? createMutation.error.parsedMessage || 'Invite conflict'
      : createMutation.error
        ? 'Failed to create invite'
        : '';

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviteUrl('');
    setCopied(false);
    createMutation.mutate(trimmed);
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const resetInviteForm = () => {
    setShowInviteForm(false);
    setEmail('');
    setSelectedRole('member');
    setInviteUrl('');
    setCopied(false);
    createMutation.reset();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pending Invites</CardTitle>
        {canProject(role, 'project:members:invite') && !showInviteForm && (
          <Button size="sm" onClick={() => setShowInviteForm(true)}>
            Invite member
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {showInviteForm && (
          <div className="border rounded-lg p-4 space-y-3">
            <form onSubmit={handleInvite} className="space-y-2">
              <Label htmlFor="invite-email">Email address</Label>
              <div className="flex gap-2">
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="colleague@example.com"
                  disabled={createMutation.isPending}
                  required
                  autoFocus
                  className="flex-1"
                />
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as 'manager' | 'member')}
                  disabled={createMutation.isPending}
                  className="px-3 py-2 text-sm border rounded-md bg-background"
                >
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={createMutation.isPending || !email.trim()}>
                  {createMutation.isPending ? 'Sending...' : 'Send'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetInviteForm}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </Button>
              </div>
            </form>
            {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
            {inviteUrl && (
              <div className="flex items-center gap-2 bg-muted rounded p-2">
                <code className="text-xs flex-1 truncate">{inviteUrl}</code>
                <Button variant="ghost" size="icon" onClick={handleCopy} title="Copy invite link">
                  <Copy className="w-4 h-4" />
                </Button>
                {copied && <span className="text-xs text-green-600">Copied!</span>}
              </div>
            )}
          </div>
        )}

        {invitesQuery.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {invitesQuery.isError && <p className="text-sm text-destructive">Failed to load invites</p>}
        {revokeMutation.isError && (
          <p className="text-sm text-destructive">Failed to revoke invite</p>
        )}
        {!invitesQuery.isLoading && !invitesQuery.isError && invites.length === 0 && (
          <p className="text-sm text-muted-foreground">No pending invites.</p>
        )}
        {!invitesQuery.isLoading && invites.length > 0 && (
          <ul className="divide-y divide-border">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Role: {inv.role} &middot; Invited by {inv.invitedByName} &middot; Expires{' '}
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                {canProject(role, 'project:invites:revoke') && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => revokeMutation.mutate(inv.id)}
                    disabled={revokeMutation.isPending && revokeMutation.variables === inv.id}
                    title="Revoke invite"
                  >
                    <X className="w-4 h-4 text-destructive" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DangerZoneSection({
  workspaceSlug,
  projectSlug,
}: {
  workspaceSlug: string;
  projectSlug: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The delete-confirmation phrase embeds the live name, so read it from the
  // loader-seeded cache too (ADR-0007) — a rename keeps the phrase in sync.
  const projectQuery = useQuery(projectQueryOptions(workspaceSlug, projectSlug));
  const projectName = projectQuery.data?.name ?? '';
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState('');

  const expectedConfirmation = `Delete ${projectName}`;

  const deleteMutation = useMutation({
    mutationFn: () => deleteProject(workspaceSlug, projectSlug, confirmation),
    onSuccess: async () => {
      // Drop the removed project from any cached project lists before leaving.
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects(workspaceSlug) });
      // Resolve next destination after deletion
      const target = await resolveProject();
      await navigate(target);
    },
  });

  const handleDelete = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmation !== expectedConfirmation) return;
    deleteMutation.mutate();
  };

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent>
        {!showConfirm ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete this project</p>
              <p className="text-xs text-muted-foreground">
                This action cannot be undone. All project data will be permanently deleted.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowConfirm(true)}
            >
              Delete project
            </Button>
          </div>
        ) : (
          <form onSubmit={handleDelete} className="space-y-3">
            <p className="text-sm">
              Type <code className="bg-muted px-1 py-0.5 rounded text-xs">{expectedConfirmation}</code> to confirm.
            </p>
            <Input
              type="text"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder={expectedConfirmation}
              disabled={deleteMutation.isPending}
              autoFocus
            />
            {deleteMutation.isError && (
              <p className="text-sm text-destructive">Failed to delete project</p>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending || confirmation !== expectedConfirmation}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Permanently delete'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowConfirm(false);
                  setConfirmation('');
                  deleteMutation.reset();
                }}
                disabled={deleteMutation.isPending}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}