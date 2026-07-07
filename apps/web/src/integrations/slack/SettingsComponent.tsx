import React, { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Button,
  Input,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
} from '@repo/ui';
import {
  createIntegration,
  updateIntegration,
  testIntegration,
  deleteIntegration,
  getIntegration,
  type MaskedIntegration,
  type TestIntegrationResult,
  type UpdateIntegrationInput,
} from '../../lib/integrations';
import { CheckCircle, AlertCircle, Clock, Trash2 } from 'lucide-react';
import { DeleteIntegrationDialog } from '../../components/delete-integration-dialog';

export interface SettingsComponentProps {
  mode: 'create' | 'edit';
  workspaceSlug: string;
  integration?: MaskedIntegration;
}

export function SlackSettingsComponent({ mode, workspaceSlug, integration }: SettingsComponentProps) {
  const navigate = useNavigate();
  const [name, setName] = useState(integration?.name || '');
  const [botToken, setBotToken] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [testResult, setTestResult] = useState<TestIntegrationResult | null>(null);
  const [currentIntegration, setCurrentIntegration] = useState<MaskedIntegration | undefined>(integration);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (integration) {
      setCurrentIntegration(integration);
    }
  }, [integration]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    setError('');
    setSuccess('');

    if (!name.trim()) {
      setError('Please enter a name for the integration');
      return;
    }

    if (mode === 'create' && (!botToken.trim() || !signingSecret.trim())) {
      setError('Bot token and signing secret are required');
      return;
    }

    if (botToken && !botToken.startsWith('xoxb-')) {
      setError('Bot token must start with xoxb-');
      return;
    }

    if (signingSecret && signingSecret.length < 16) {
      setError('Signing secret must be at least 16 characters');
      return;
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        const created = await createIntegration(workspaceSlug, {
          type: 'slack',
          name,
          config: {
            botToken,
            signingSecret,
          },
        });
        setSuccess('Slack integration created successfully');
        setTimeout(() => {
          navigate({
            to: '/w/$workspaceSlug/integrations/$integrationId',
            params: { workspaceSlug, integrationId: created.id },
          });
        }, 500);
      } else if (integration) {
        const updateData: UpdateIntegrationInput = { name };
        const config: Record<string, unknown> = {};

        if (botToken.trim()) {
          config.botToken = botToken;
        }
        if (signingSecret.trim()) {
          config.signingSecret = signingSecret;
        }

        if (Object.keys(config).length > 0) {
          updateData.config = config;
        }

        await updateIntegration(workspaceSlug, integration.id, updateData);

        // Reload the integration to get updated status after auto-retest
        const updated = await getIntegration(workspaceSlug, integration.id);
        setCurrentIntegration(updated);
        setBotToken('');
        setSigningSecret('');

        setSuccess('Slack integration updated successfully');
      }
    } catch (error) {
      console.error('Failed to save integration:', error);
      setError('Failed to save integration');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!currentIntegration) return;

    setTesting(true);
    setTestResult(null);
    setError('');
    setSuccess('');

    try {
      const result = await testIntegration(workspaceSlug, currentIntegration.id);
      setTestResult(result);

      // Reload integration to get updated status
      const updated = await getIntegration(workspaceSlug, currentIntegration.id);
      setCurrentIntegration(updated);

      if (result.status === 'active') {
        setSuccess('Connection test successful');
      } else {
        setError(`Connection test failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to test integration:', error);
      setError('Failed to test connection');
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!currentIntegration) return;

    setDeleting(true);
    try {
      await deleteIntegration(workspaceSlug, currentIntegration.id);
      navigate({
        to: '/w/$workspaceSlug/integrations',
        params: { workspaceSlug },
      });
    } catch (error) {
      console.error('Failed to delete integration:', error);
      setError('Failed to delete integration');
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {mode === 'create' ? 'Add Slack Integration' : 'Edit Slack Integration'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded">
              {success}
            </div>
          )}

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <h3 className="font-semibold text-sm mb-2 text-foreground">Setup Instructions</h3>
            <ol className="text-sm space-y-1 list-decimal list-inside text-muted-foreground">
              <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">api.slack.com/apps</a> and create a new app</li>
              <li>Under <strong>OAuth & Permissions</strong>, add these bot scopes: <code>channels:history</code>, <code>channels:read</code>, <code>groups:history</code>, <code>groups:read</code>, <code>users:read</code></li>
              <li>Install the app to your workspace and copy the <strong>Bot User OAuth Token</strong> (starts with xoxb-)</li>
              <li>Under <strong>Basic Information → App Credentials</strong>, copy the <strong>Signing Secret</strong></li>
              <li>Enter both values below to complete the integration</li>
            </ol>
          </div>

          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <Label htmlFor="name">Integration Name</Label>
              <Input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., My Slack Workspace"
                required
              />
            </div>

            <div>
              <Label htmlFor="botToken">Bot User OAuth Token</Label>
              <Input
                id="botToken"
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder={mode === 'edit' ? 'Leave blank to keep existing token' : 'xoxb-...'}
                required={mode === 'create'}
              />
              {mode === 'edit' && (
                <p className="text-xs text-muted-foreground mt-1">
                  Current token is encrypted and hidden for security
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="signingSecret">Signing Secret</Label>
              <Input
                id="signingSecret"
                type="password"
                value={signingSecret}
                onChange={(e) => setSigningSecret(e.target.value)}
                placeholder={mode === 'edit' ? 'Leave blank to keep existing secret' : 'Enter signing secret'}
                required={mode === 'create'}
              />
              {mode === 'edit' && (
                <p className="text-xs text-muted-foreground mt-1">
                  Current secret is encrypted and hidden for security
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : (mode === 'create' ? 'Create Integration' : 'Save Changes')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({
                  to: '/w/$workspaceSlug/integrations',
                  params: { workspaceSlug },
                })}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {mode === 'edit' && currentIntegration && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Connection Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={currentIntegration.status} />
                    <span className="font-medium capitalize">{currentIntegration.status}</span>
                  </div>

                  {currentIntegration.lastTestedAt && (
                    <p className="text-sm text-muted-foreground">
                      Last tested: {new Date(currentIntegration.lastTestedAt).toLocaleString()}
                    </p>
                  )}

                  {currentIntegration.status === 'error' && currentIntegration.lastTestError && (
                    <p className="text-sm text-red-400">
                      Error: <code className="bg-red-500/10 border border-red-500/30 px-1 py-0.5 rounded">{currentIntegration.lastTestError}</code>
                    </p>
                  )}
                </div>

                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={testing}
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </Button>
              </div>

              {testResult && testResult.info && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                  <h4 className="font-semibold text-sm text-green-400 mb-2">Connection Details</h4>
                  <dl className="text-sm space-y-1">
                    {Object.entries(testResult.info).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <dt className="font-medium text-muted-foreground capitalize">{key}:</dt>
                        <dd className="text-foreground">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Delete Integration</p>
                  <p className="text-sm text-muted-foreground">
                    This action cannot be undone. All configuration will be lost.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteDialog(true)}
                  disabled={deleting}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Integration
                </Button>
              </div>
            </CardContent>
          </Card>

          {showDeleteDialog && (
            <DeleteIntegrationDialog
              open={showDeleteDialog}
              onOpenChange={setShowDeleteDialog}
              integrationName={currentIntegration.name}
              onConfirm={handleDelete}
              isDeleting={deleting}
            />
          )}
        </>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: MaskedIntegration['status'] }) {
  if (status === 'active') {
    return <CheckCircle className="h-5 w-5 text-green-600" />;
  }
  if (status === 'error') {
    return <AlertCircle className="h-5 w-5 text-red-600" />;
  }
  return <Clock className="h-5 w-5 text-yellow-600" />;
}
