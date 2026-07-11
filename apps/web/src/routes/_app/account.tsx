import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSession, updateUser, changeEmail, changePassword } from '../../lib/auth-client';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { PASSWORD_MIN_LENGTH, mcpConnectorSchema } from '@repo/shared';
import { apiFetchParsed } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';

export const Route = createFileRoute('/_app/account')({
  component: AccountPage,
});

function AccountPage() {
  const session = useSession();
  const user = session.data?.user;

  // Form-input / edit-toggle state is UI state and stays local.
  const [name, setName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [isEditingEmail, setIsEditingEmail] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // MCP connector URL — server state, read through the shared query key.
  const mcpQuery = useQuery({
    queryKey: queryKeys.mcpConnector(),
    queryFn: () => apiFetchParsed('/api/me/mcp-connector', mcpConnectorSchema),
  });
  const mcpUrl = mcpQuery.data?.url ?? '';
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const handleCopy = async () => {
    if (!mcpUrl) return;
    try {
      await navigator.clipboard.writeText(mcpUrl);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  // Identity writes: name/email live in Better Auth's session (not a TanStack
  // Query), so on success we refresh identity via session.refetch() rather than
  // invalidating a query. Each mutation owns its loading/error/success state.
  const nameMutation = useMutation({
    mutationFn: async (nextName: string) => {
      const response = await updateUser({ name: nextName });
      if (response.error) {
        throw new Error(response.error.message || 'Failed to update name');
      }
    },
    onSuccess: async () => {
      setIsEditingName(false);
      await session.refetch();
    },
  });

  const emailMutation = useMutation({
    mutationFn: async (nextEmail: string) => {
      const response = await changeEmail(nextEmail);
      if (response.error) {
        throw new Error(response.error.message || 'Failed to update email');
      }
    },
    onSuccess: async () => {
      setIsEditingEmail(false);
      setNewEmail('');
      await session.refetch();
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) {
        throw new Error('New passwords do not match');
      }
      if (newPassword.length < PASSWORD_MIN_LENGTH) {
        throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
      }
      const response = await changePassword(currentPassword, newPassword);
      if (response.error) {
        throw new Error(response.error.message || 'Failed to change password');
      }
    },
    onSuccess: () => {
      setIsChangingPassword(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
  });

  const handleNameUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    nameMutation.mutate(name);
  };

  const handleEmailUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    emailMutation.mutate(newEmail);
  };

  const handlePasswordChange = (e: React.FormEvent) => {
    e.preventDefault();
    passwordMutation.mutate();
  };

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Account Settings</h1>

        {/* Profile Information */}
        <Card>
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Name Section */}
            <div>
              <Label htmlFor="name" className="text-sm text-muted-foreground">
                Name
              </Label>
              {!isEditingName ? (
                <div className="flex items-center justify-between mt-1">
                  <p className="text-lg">{user?.name || 'Not set'}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditingName(true);
                      setName(user?.name || '');
                      nameMutation.reset();
                    }}
                  >
                    Edit
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleNameUpdate} className="mt-2 space-y-2">
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your name"
                    disabled={nameMutation.isPending}
                    required
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={nameMutation.isPending}>
                      {nameMutation.isPending ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditingName(false);
                        nameMutation.reset();
                      }}
                      disabled={nameMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
              {nameMutation.error && (
                <p className="text-sm text-destructive mt-2">{nameMutation.error.message}</p>
              )}
              {nameMutation.isSuccess && (
                <p className="text-sm text-green-600 mt-2">Name updated successfully</p>
              )}
            </div>

            {/* Email Section */}
            <div>
              <Label htmlFor="email" className="text-sm text-muted-foreground">
                Email
              </Label>
              {!isEditingEmail ? (
                <div className="flex items-center justify-between mt-1">
                  <p className="text-lg">{user?.email}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditingEmail(true);
                      setNewEmail('');
                      emailMutation.reset();
                    }}
                  >
                    Edit
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleEmailUpdate} className="mt-2 space-y-2">
                  <Input
                    id="email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="Enter new email"
                    disabled={emailMutation.isPending}
                    required
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={emailMutation.isPending}>
                      {emailMutation.isPending ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditingEmail(false);
                        emailMutation.reset();
                      }}
                      disabled={emailMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
              {emailMutation.error && (
                <p className="text-sm text-destructive mt-2">{emailMutation.error.message}</p>
              )}
              {emailMutation.isSuccess && (
                <p className="text-sm text-green-600 mt-2">Email updated successfully</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Password Section */}
        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
          </CardHeader>
          <CardContent>
            {!isChangingPassword ? (
              <Button
                variant="outline"
                onClick={() => {
                  setIsChangingPassword(true);
                  passwordMutation.reset();
                }}
              >
                Change Password
              </Button>
            ) : (
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div>
                  <Label htmlFor="current-password">Current Password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    disabled={passwordMutation.isPending}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    disabled={passwordMutation.isPending}
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    At least {PASSWORD_MIN_LENGTH} characters
                  </p>
                </div>
                <div>
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    disabled={passwordMutation.isPending}
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={passwordMutation.isPending}>
                    {passwordMutation.isPending ? 'Changing...' : 'Change Password'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsChangingPassword(false);
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                      passwordMutation.reset();
                    }}
                    disabled={passwordMutation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {passwordMutation.error && (
              <p className="text-sm text-destructive mt-2">{passwordMutation.error.message}</p>
            )}
            {passwordMutation.isSuccess && (
              <p className="text-sm text-green-600 mt-2">Password changed successfully</p>
            )}
          </CardContent>
        </Card>

        {/* MCP Connector */}
        <Card>
          <CardHeader>
            <CardTitle>Model Context Protocol (MCP)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connect AI agents like Claude Desktop, Claude.ai, or Cursor to your account.
            </p>

            {mcpQuery.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
            {mcpQuery.error && (
              <p className="text-sm text-destructive">Failed to load MCP connector URL</p>
            )}
            {mcpUrl && (
              <>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono break-all">
                    {mcpUrl}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>

                <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1">
                  <li>Copy the URL above.</li>
                  <li>
                    In Claude Desktop: Settings &rarr; Connectors &rarr; Add custom connector &rarr;
                    paste.
                  </li>
                  <li>Sign in and approve access when prompted.</li>
                </ol>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
