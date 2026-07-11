import { createFileRoute, getRouteApi, useNavigate, useRouter } from '@tanstack/react-router';
import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { canWorkspace, type WorkspaceRole } from '../lib/permissions';
import { resolveProject } from '../lib/project-resolver';
import {
  updateWorkspace,
  deleteWorkspace,
  removeWorkspaceMember,
  createWorkspaceInvite,
  revokeWorkspaceInvite,
} from '../lib/workspaces';
import {
  workspaceMembersQuery,
  workspaceInvitesQuery,
} from '../lib/workspace-settings-queries';
import { Copy, UserMinus, X } from 'lucide-react';

const workspaceRoute = getRouteApi('/_app/w/$workspaceSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/settings')({
  component: WorkspaceSettingsPage,
});

function WorkspaceSettingsPage() {
  const { workspace } = workspaceRoute.useLoaderData();
  const { role } = workspace;

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Workspace Settings</h1>

        <GeneralSection
          workspaceName={workspace.name}
          workspaceSlug={workspace.slug}
          role={role}
        />
        <MembersSection slug={workspace.slug} role={role} />
        <InvitesSection slug={workspace.slug} role={role} />
        {canWorkspace(role, 'workspace:delete') && (
          <DangerZoneSection
            workspaceName={workspace.name}
            workspaceSlug={workspace.slug}
          />
        )}
      </div>
    </div>
  );
}

function GeneralSection({
  workspaceName,
  workspaceSlug,
  role,
}: {
  workspaceName: string;
  workspaceSlug: string;
  role: WorkspaceRole;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      await updateWorkspace(workspaceSlug, trimmed);
      setSuccess('Name updated');
      setIsEditing(false);
      await router.invalidate();
    } catch {
      setError('Failed to update workspace name');
    } finally {
      setIsLoading(false);
    }
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
                    setError('');
                    setSuccess('');
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
                disabled={isLoading}
                required
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isLoading || !name.trim()}>
                  {isLoading ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsEditing(false);
                    setError('');
                    setSuccess('');
                  }}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-green-600">{success}</p>}
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
  const [error, setError] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleRemove = async (userId: string) => {
    setRemovingId(userId);
    try {
      await removeWorkspaceMember(slug, userId);
      await membersQuery.refetch();
    } catch {
      setError('Failed to remove member');
    } finally {
      setRemovingId(null);
    }
  };

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
        {error && <p className="text-sm text-destructive">{error}</p>}
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
                      onClick={() => handleRemove(member.userId)}
                      disabled={removingId === member.userId}
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
  const [error, setError] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<'manager' | 'member'>('member');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setInviteError('');
    setInviteUrl('');
    setCopied(false);
    setIsInviting(true);

    try {
      const result = await createWorkspaceInvite(slug, trimmed, selectedRole);
      setInviteUrl(result.inviteUrl);
      setEmail('');
      await invitesQuery.refetch();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'error' in err && err.error && typeof err.error === 'object' && 'message' in err.error && typeof err.error.message === 'string') {
        setInviteError(err.error.message);
      } else {
        setInviteError('Failed to create invite');
      }
    } finally {
      setIsInviting(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const handleRevoke = async (inviteId: string) => {
    setRevokingId(inviteId);
    try {
      await revokeWorkspaceInvite(slug, inviteId);
      await invitesQuery.refetch();
    } catch {
      setError('Failed to revoke invite');
    } finally {
      setRevokingId(null);
    }
  };

  const resetInviteForm = () => {
    setShowInviteForm(false);
    setEmail('');
    setSelectedRole('member');
    setInviteError('');
    setInviteUrl('');
    setCopied(false);
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
                  disabled={isInviting}
                  required
                  autoFocus
                  className="flex-1"
                />
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as 'manager' | 'member')}
                  disabled={isInviting}
                  className="px-3 py-2 text-sm border rounded-md bg-background"
                >
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isInviting || !email.trim()}>
                  {isInviting ? 'Sending...' : 'Send'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetInviteForm}
                  disabled={isInviting}
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
        {invitesQuery.isError && (
          <p className="text-sm text-destructive">Failed to load invites</p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
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
                    onClick={() => handleRevoke(inv.id)}
                    disabled={revokingId === inv.id}
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
  workspaceName,
  workspaceSlug,
}: {
  workspaceName: string;
  workspaceSlug: string;
}) {
  const navigate = useNavigate();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  const expectedConfirmation = `Delete ${workspaceName}`;

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmation !== expectedConfirmation) return;

    setError('');
    setIsDeleting(true);

    try {
      await deleteWorkspace(workspaceSlug, confirmation);
      // Resolve next destination after deletion
      const target = await resolveProject();
      await navigate(target);
    } catch {
      setError('Failed to delete workspace');
      setIsDeleting(false);
    }
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
              disabled={isDeleting}
              autoFocus
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={isDeleting || confirmation !== expectedConfirmation}
              >
                {isDeleting ? 'Deleting...' : 'Delete workspace'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowConfirm(false);
                  setConfirmation('');
                  setError('');
                }}
                disabled={isDeleting}
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