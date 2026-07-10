import { createFileRoute, getRouteApi, useNavigate, useRouter } from '@tanstack/react-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { useSession } from '../lib/auth-client';
import { ApiError } from '../lib/api';
import { canProject, type ProjectRole } from '../lib/permissions';
import { resolveProject } from '../lib/project-resolver';
import {
  updateProject,
  deleteProject,
  listProjectMembers,
  removeProjectMember,
  listProjectInvites,
  createProjectInvite,
  revokeProjectInvite,
  type ProjectMember,
  type ProjectInvite,
} from '../lib/projects';
import { Copy, UserMinus, X } from 'lucide-react';

const projectRoute = getRouteApi('/_app/w/$workspaceSlug/p/$projectSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/p/$projectSlug/settings')({
  component: ProjectSettingsPage,
});

function ProjectSettingsPage() {
  const { project } = projectRoute.useLoaderData();
  const { role } = project;

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Settings</h1>

        <GeneralSection
          workspaceSlug={project.workspaceSlug}
          projectName={project.name}
          projectSlug={project.slug}
          role={role}
        />
        <MembersSection workspaceSlug={project.workspaceSlug} slug={project.slug} role={role} />
        <InvitesSection workspaceSlug={project.workspaceSlug} slug={project.slug} role={role} />
        {canProject(role, 'project:delete') && (
          <DangerZoneSection
            workspaceSlug={project.workspaceSlug}
            projectName={project.name}
            projectSlug={project.slug}
          />
        )}
      </div>
    </div>
  );
}

function GeneralSection({
  workspaceSlug,
  projectName,
  projectSlug,
  role,
}: {
  workspaceSlug: string;
  projectName: string;
  projectSlug: string;
  role: ProjectRole;
}) {
  const router = useRouter();
  const [isEditingName, setIsEditingName] = useState(false);
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      await updateProject(workspaceSlug, projectSlug, { name: trimmed });
      setSuccess('Name updated');
      setIsEditingName(false);
      await router.invalidate();
    } catch {
      setError('Failed to update project name');
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
                    setError('');
                    setSuccess('');
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
                    setIsEditingName(false);
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

  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setMembers(await listProjectMembers(workspaceSlug, slug));
    } catch {
      setError('Failed to load members');
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug, slug]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleRemove = async (userId: string) => {
    setRemovingId(userId);
    try {
      await removeProjectMember(workspaceSlug, slug, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch {
      setError('Failed to remove member');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && members.length === 0 && (
          <p className="text-sm text-muted-foreground">No members found.</p>
        )}
        {!loading && members.length > 0 && (
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
                        onClick={() => handleRemove(member.userId)}
                        disabled={removingId === member.userId}
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
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<'manager' | 'member'>('member');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const [revokingId, setRevokingId] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const fetchInvites = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setInvites(await listProjectInvites(workspaceSlug, slug));
    } catch {
      setError('Failed to load invites');
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug, slug]);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setInviteError('');
    setInviteUrl('');
    setCopied(false);
    setIsInviting(true);

    try {
      const result = await createProjectInvite(workspaceSlug, slug, trimmed, selectedRole);
      setInviteUrl(result.inviteUrl);
      setEmail('');
      setInvites((prev) => [result.invite, ...prev]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setInviteError(err.parsedMessage || 'Invite conflict');
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
      await revokeProjectInvite(workspaceSlug, slug, inviteId);
      setInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
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

        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && invites.length === 0 && (
          <p className="text-sm text-muted-foreground">No pending invites.</p>
        )}
        {!loading && invites.length > 0 && (
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
  workspaceSlug,
  projectName,
  projectSlug,
}: {
  workspaceSlug: string;
  projectName: string;
  projectSlug: string;
}) {
  const navigate = useNavigate();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState('');

  const expectedConfirmation = `Delete ${projectName}`;

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmation !== expectedConfirmation) return;

    setError('');
    setIsDeleting(true);

    try {
      await deleteProject(workspaceSlug, projectSlug, confirmation);
      // Resolve next destination after deletion
      const target = await resolveProject();
      await navigate(target);
    } catch {
      setError('Failed to delete project');
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
                {isDeleting ? 'Deleting...' : 'Permanently delete'}
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