import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSession, updateUser, changeEmail, changePassword } from '../../lib/auth-client';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { PASSWORD_MIN_LENGTH, mcpConnectorSchema } from '@repo/shared';
import { apiFetchParsed } from '../../lib/api';

export const Route = createFileRoute('/_app/account')({
  component: AccountPage,
});

function AccountPage() {
  const session = useSession();
  const user = session.data?.user;

  // Name editing state
  const [name, setName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameLoading, setNameLoading] = useState(false);
  const [nameError, setNameError] = useState('');
  const [nameSuccess, setNameSuccess] = useState('');

  // Email editing state
  const [newEmail, setNewEmail] = useState('');
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState('');

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // MCP connector
  const mcpQuery = useQuery({
    queryKey: ['me', 'mcp-connector'],
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

  // Handle name update
  const handleNameUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setNameError('');
    setNameSuccess('');
    setNameLoading(true);

    try {
      const response = await updateUser({ name });

      if (response.error) {
        setNameError(response.error.message || 'Failed to update name');
      } else {
        setNameSuccess('Name updated successfully');
        setIsEditingName(false);
        // Refresh session to get updated user data
        await session.refetch();
      }
    } catch {
      setNameError('An unexpected error occurred');
    } finally {
      setNameLoading(false);
    }
  };

  // Handle email update
  const handleEmailUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess('');
    setEmailLoading(true);

    try {
      const response = await changeEmail(newEmail);

      if (response.error) {
        setEmailError(response.error.message || 'Failed to update email');
      } else {
        setEmailSuccess('Email updated successfully');
        setIsEditingEmail(false);
        setNewEmail('');
        // Refresh session to get updated user data
        await session.refetch();
      }
    } catch {
      setEmailError('An unexpected error occurred');
    } finally {
      setEmailLoading(false);
    }
  };

  // Handle password change
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setPasswordError(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await changePassword(currentPassword, newPassword);

      if (response.error) {
        setPasswordError(response.error.message || 'Failed to change password');
      } else {
        setPasswordSuccess('Password changed successfully');
        setIsChangingPassword(false);
        // Clear form
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch {
      setPasswordError('An unexpected error occurred');
    } finally {
      setPasswordLoading(false);
    }
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
              <Label htmlFor="name" className="text-sm text-muted-foreground">Name</Label>
              {!isEditingName ? (
                <div className="flex items-center justify-between mt-1">
                  <p className="text-lg">{user?.name || 'Not set'}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditingName(true);
                      setName(user?.name || '');
                      setNameError('');
                      setNameSuccess('');
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
                    disabled={nameLoading}
                    required
                  />
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={nameLoading}
                    >
                      {nameLoading ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditingName(false);
                        setNameError('');
                        setNameSuccess('');
                      }}
                      disabled={nameLoading}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
              {nameError && (
                <p className="text-sm text-destructive mt-2">{nameError}</p>
              )}
              {nameSuccess && (
                <p className="text-sm text-green-600 mt-2">{nameSuccess}</p>
              )}
            </div>

            {/* Email Section */}
            <div>
              <Label htmlFor="email" className="text-sm text-muted-foreground">Email</Label>
              {!isEditingEmail ? (
                <div className="flex items-center justify-between mt-1">
                  <p className="text-lg">{user?.email}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditingEmail(true);
                      setNewEmail('');
                      setEmailError('');
                      setEmailSuccess('');
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
                    disabled={emailLoading}
                    required
                  />
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={emailLoading}
                    >
                      {emailLoading ? 'Saving...' : 'Save'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditingEmail(false);
                        setEmailError('');
                        setEmailSuccess('');
                      }}
                      disabled={emailLoading}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
              {emailError && (
                <p className="text-sm text-destructive mt-2">{emailError}</p>
              )}
              {emailSuccess && (
                <p className="text-sm text-green-600 mt-2">{emailSuccess}</p>
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
                  setPasswordError('');
                  setPasswordSuccess('');
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
                    disabled={passwordLoading}
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
                    disabled={passwordLoading}
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
                    disabled={passwordLoading}
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    disabled={passwordLoading}
                  >
                    {passwordLoading ? 'Changing...' : 'Change Password'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsChangingPassword(false);
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                      setPasswordError('');
                      setPasswordSuccess('');
                    }}
                    disabled={passwordLoading}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {passwordError && (
              <p className="text-sm text-destructive mt-2">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="text-sm text-green-600 mt-2">{passwordSuccess}</p>
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

            {mcpQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Loading...</p>
            )}
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
                  <li>In Claude Desktop: Settings &rarr; Connectors &rarr; Add custom connector &rarr; paste.</li>
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