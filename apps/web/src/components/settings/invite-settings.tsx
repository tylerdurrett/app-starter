import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { Copy, X } from 'lucide-react';
import { apiErrorMessage } from '../../lib/api';

export type InviteRole = 'manager' | 'member';

export interface PendingInvite {
  id: string;
  email: string;
  role: InviteRole;
  invitedByName: string;
  expiresAt: string;
}

export interface InviteSettingsAdapter {
  queryKey: QueryKey;
  listInvites: () => Promise<PendingInvite[]>;
  createInvite: (email: string, role: InviteRole) => Promise<{ inviteUrl: string }>;
  revokeInvite: (inviteId: string) => Promise<unknown>;
  refreshInvites: () => Promise<unknown>;
  canList: boolean;
  canCreate: boolean;
  canRevoke: boolean;
}

export function InviteSettings({ adapter }: { adapter: InviteSettingsAdapter }) {
  const emailInputId = useId();
  const invitesQuery = useQuery({
    queryKey: adapter.queryKey,
    queryFn: adapter.listInvites,
    enabled: adapter.canList,
  });
  const invites = invitesQuery.data ?? [];
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('member');
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const createMutation = useMutation({
    mutationFn: ({
      trimmedEmail,
      selectedRole,
    }: {
      trimmedEmail: string;
      selectedRole: InviteRole;
    }) => adapter.createInvite(trimmedEmail, selectedRole),
    onSuccess: async (result) => {
      setInviteUrl(result.inviteUrl);
      setEmail('');
      await adapter.refreshInvites();
    },
  });
  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => adapter.revokeInvite(inviteId),
    onSuccess: async () => {
      await adapter.refreshInvites();
    },
  });

  const clearCopyState = () => {
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = undefined;
    setCopied(false);
  };

  useEffect(
    () => () => {
      clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || createMutation.isPending) return;

    setInviteUrl('');
    clearCopyState();
    createMutation.mutate({ trimmedEmail, selectedRole: role });
  };

  const handleCopy = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  const resetForm = () => {
    setShowForm(false);
    setEmail('');
    setRole('member');
    setInviteUrl('');
    clearCopyState();
    createMutation.reset();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pending Invites</CardTitle>
        {adapter.canCreate && !showForm && (
          <Button size="sm" onClick={() => setShowForm(true)}>
            Invite member
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="border rounded-lg p-4 space-y-3">
            <form onSubmit={handleSubmit} className="space-y-2" aria-label="Create invite">
              <Label htmlFor={emailInputId}>Email address</Label>
              <div className="flex gap-2">
                <Input
                  id={emailInputId}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="colleague@example.com"
                  disabled={createMutation.isPending}
                  required
                  autoFocus
                  className="flex-1"
                />
                <select
                  aria-label="Role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as InviteRole)}
                  disabled={createMutation.isPending}
                  className="px-3 py-2 text-sm border rounded-md bg-background"
                >
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={createMutation.isPending || !email.trim()}
                >
                  {createMutation.isPending ? 'Sending...' : 'Send'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={resetForm}
                  disabled={createMutation.isPending}
                >
                  Cancel
                </Button>
              </div>
            </form>
            {createMutation.isError && (
              <p className="text-sm text-destructive">
                {apiErrorMessage(createMutation.error, 'Failed to create invite')}
              </p>
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

        {adapter.canList && invitesQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
        {adapter.canList && invitesQuery.isError && (
          <p className="text-sm text-destructive">Failed to load invites</p>
        )}
        {revokeMutation.isError && (
          <p className="text-sm text-destructive">
            {apiErrorMessage(revokeMutation.error, 'Failed to revoke invite')}
          </p>
        )}
        {adapter.canList &&
          !invitesQuery.isLoading &&
          !invitesQuery.isError &&
          invites.length === 0 && (
            <p className="text-sm text-muted-foreground">No pending invites.</p>
          )}
        {adapter.canList && !invitesQuery.isLoading && invites.length > 0 && (
          <ul className="divide-y divide-border">
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">{invite.email}</p>
                  <p className="text-xs text-muted-foreground">
                    Role: {invite.role} &middot; Invited by {invite.invitedByName} &middot; Expires{' '}
                    {new Date(invite.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                {adapter.canRevoke && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => revokeMutation.mutate(invite.id)}
                    disabled={revokeMutation.isPending && revokeMutation.variables === invite.id}
                    title={`Revoke invite for ${invite.email}`}
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
