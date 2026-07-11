import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { canWorkspace, type WorkspaceRole } from '../lib/permissions';
import { resolveProject } from '../lib/project-resolver';
import {
  workspaceQueryOptions,
  workspaceMembersQuery,
  workspaceInvitesQuery,
  renameWorkspaceMutation,
  removeWorkspaceMemberMutation,
  createWorkspaceInviteMutation,
  revokeWorkspaceInviteMutation,
  deleteWorkspaceMutation,
} from '../lib/workspace-settings-queries';
import { Copy, UserMinus, X } from 'lucide-react';

const workspaceRoute = getRouteApi('/_app/w/$workspaceSlug');

// The invite-create endpoint returns a structured `{ error: { message } }` on
// failure; surface that message when present, else a generic fallback.
function inviteErrorMessage(err: unknown): string {
  if (
    err &&
    typeof err === 'object' &&
    'error' in err &&
    err.error &&
    typeof err.error === 'object' &&
    'message' in err.error &&
    typeof err.error.message === 'string'
  ) {
    return err.error.message;
  }
  return 'Failed to create invite';
}

export const Route = createFileRoute('/_app/w/$workspaceSlug/settings')({
  component: WorkspaceSettingsPage,
});

function WorkspaceSettingsPage() {
  // Loader data is gating-derived only: slug/role don't change on this page.
  // The mutable display name is read via useQuery in each section (seeded by
  // the layout loader) so a rename refreshes live (ADR-0007).
  const { workspace } = workspaceRoute.useLoaderData();
  const { slug, role } = workspace;

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Workspace Settings</h1>

        <GeneralSection workspaceSlug={slug} role={role} />
        <MembersSection slug={slug} role={role} />
        <InvitesSection slug={slug} role={role} />
        {canWorkspace(role, 'workspace:delete') && <DangerZoneSection workspaceSlug={slug} />}
      </div>
    </div>
  );
}

function GeneralSection({
  workspaceSlug,
  role,
}: {
  workspaceSlug: string;
  role: WorkspaceRole;
}) {
  const queryClient = useQueryClient();
  // Read the mutable name through the loader-seeded cache so the rename
  // invalidation below refreshes it without a page reload (ADR-0007).
  const workspaceQuery = useQuery(workspaceQueryOptions(workspaceSlug));
  const workspaceName = workspaceQuery.data?.name ?? '';
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState('');
  const renameMutation = useMutation(renameWorkspaceMutation(queryClient, workspaceSlug));

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    renameMutation.mutate(trimmed, {
      onSuccess: () => setIsEditing(false),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-sm text-muted-foreground">Name</Label>
          {!isEditing ? (
            <div className="flex items-center justify-between mt-1">
              <p className="text-lg">{workspaceName}</p>
              {canWorkspace(role, 'workspace:edit') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditing(true);
                    setName(workspaceName);
                    renameMutation.reset();
                  }}
                >
                  Edit
                </Button>
              )}
            </div>
          ) : (
            <form onSubmit={handleSave} className="mt-2 space-y-2">
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Workspace name"
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
                    setIsEditing(false);
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
          <p className="text-sm text-destructive">Failed to update workspace name</p>
        )}
        {renameMutation.isSuccess && <p className="text-sm text-green-600">Name updated</p>}
      </CardContent>
    </Card>
  );
}

function MembersSection({ slug, role }: { slug: string; role: WorkspaceRole }) {
  const canList = canWorkspace(role, 'workspace:members:list');
  const membersQuery = useQuery({
    ...workspaceMembersQuery(slug),
    enabled: canList,
  });
  const members = membersQuery.data ?? [];
  const queryClient = useQueryClient();
  const removeMutation = useMutation(removeWorkspaceMemberMutation(queryClient, slug));

  if (!canList) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You don't have permission to view members.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent>
        {membersQuery.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {membersQuery.isError && (
          <p className="text-sm text-destructive">Failed to load members</p>
        )}
        {removeMutation.isError && (
          <p className="text-sm text-destructive">Failed to remove member</p>
        )}
        {!membersQuery.isLoading && members.length === 0 && (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        )}
        {!membersQuery.isLoading && members.length > 0 && (
          <ul className="divide-y divide-border">
            {members.map((member) => (
              <li key={member.userId} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">{member.name}</p>
                  <p className="text-xs text-muted-foreground">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-1 bg-muted rounded">{member.role}</span>
                  {canWorkspace(role, 'workspace:members:remove') && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMutation.mutate(member.userId)}
                      disabled={
                        removeMutation.isPending && removeMutation.variables === member.userId
                      }
                      title="Remove member"
                    >
                      <UserMinus className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InvitesSection({ slug, role }: { slug: string; role: WorkspaceRole }) {
  const canList = canWorkspace(role, 'workspace:invites:list');
  const invitesQuery = useQuery({
    ...workspaceInvitesQuery(slug),
    enabled: canList,
  });
  const invites = invitesQuery.data ?? [];
  const queryClient = useQueryClient();
  const createMutation = useMutation(createWorkspaceInviteMutation(queryClient, slug));
  const revokeMutation = useMutation(revokeWorkspaceInviteMutation(queryClient, slug));

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<'manager' | 'member'>('member');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setInviteUrl('');
    setCopied(false);
    createMutation.mutate(
      { email: trimmed, role: selectedRole },
      {
        onSuccess: (result) => {
          setInviteUrl(result.inviteUrl);
          setEmail('');
        },
      },
    );
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
        {canWorkspace(role, 'workspace:members:invite') && !showInviteForm && (
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
            {createMutation.isError && (
              <p className="text-sm text-destructive">{inviteErrorMessage(createMutation.error)}</p>
            )}
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
        {invitesQuery.isError && (
          <p className="text-sm text-destructive">Failed to load invites</p>
        )}
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
                {canWorkspace(role, 'workspace:invites:revoke') && (
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

function DangerZoneSection({ workspaceSlug }: { workspaceSlug: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // The delete-confirmation phrase embeds the live name, so read it from the
  // loader-seeded cache too (ADR-0007) — a rename keeps the phrase in sync.
  const workspaceQuery = useQuery(workspaceQueryOptions(workspaceSlug));
  const workspaceName = workspaceQuery.data?.name ?? '';
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const deleteMutation = useMutation(deleteWorkspaceMutation(queryClient, workspaceSlug));

  const expectedConfirmation = `Delete ${workspaceName}`;

  const handleDelete = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmation !== expectedConfirmation) return;

    // Invalidation (workspaces list) runs in the mutation's own onSuccess; then
    // resolve the next destination and navigate away.
    deleteMutation.mutate(confirmation, {
      onSuccess: async () => {
        const target = await resolveProject();
        await navigate(target);
      },
    });
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
              <p className="text-sm font-medium">Delete this workspace</p>
              <p className="text-xs text-muted-foreground">
                This action cannot be undone. All projects and data will be permanently deleted.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowConfirm(true)}
            >
              Delete workspace
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
              placeholder="Enter confirmation text"
              disabled={deleteMutation.isPending}
              autoFocus
            />
            {deleteMutation.isError && (
              <p className="text-sm text-destructive">Failed to delete workspace</p>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending || confirmation !== expectedConfirmation}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete workspace'}
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