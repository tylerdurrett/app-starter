import React, { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  type MaskedIntegration,
  type TestIntegrationResult,
  type UpdateIntegrationInput,
} from '../../lib/integrations';
import { queryKeys } from '../../lib/query-keys';
import { CheckCircle, AlertCircle, Clock, Trash2 } from 'lucide-react';
import { DeleteIntegrationDialog } from '../../components/delete-integration-dialog';

export interface SettingsComponentProps {
  mode: 'create' | 'edit';
  workspaceSlug: string;
  integration?: MaskedIntegration;
}

export function SlackSettingsComponent({ mode, workspaceSlug, integration }: SettingsComponentProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(integration?.name || '');
  const [botToken, setBotToken] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [testResult, setTestResult] = useState<TestIntegrationResult | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Invalidate both the detail and the list keys after an edit-mode write so
  // the detail view (which reads the integration via useQuery) and the list
  // both reflect the mutated data without a manual reload.
  const invalidateIntegration = () =>
    Promise.all([
      integration &&
        queryClient.invalidateQueries({
          queryKey: queryKeys.integration(workspaceSlug, integration.id),
        }),
      queryClient.invalidateQueries({ queryKey: queryKeys.integrations(workspaceSlug) }),
    ]);

  // Create mode: POST then navigate to the new detail route. Also invalidate
  // the list so it shows the new integration when navigated back.
  const createMutation = useMutation({
    mutationFn: () =>
      createIntegration(workspaceSlug, {
        type: 'slack',
        name,
        config: { botToken, signingSecret },
      }),
    onSuccess: async (created) => {
      setSuccess('Slack integration created successfully');
      await queryClient.invalidateQueries({ queryKey: queryKeys.integrations(workspaceSlug) });
      setTimeout(() => {
        navigate({
          to: '/w/$workspaceSlug/integrations/$integrationId',
          params: { workspaceSlug, integrationId: created.id },
        });
      }, 500);
    },
    onError: (err) => {
      console.error('Failed to save integration:', err);
      setError('Failed to save integration');
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!integration) throw new Error('Missing integration');
      const updateData: UpdateIntegrationInput = { name };
      const config: Record<string, unknown> = {};
      if (botToken.trim()) config.botToken = botToken;
      if (signingSecret.trim()) config.signingSecret = signingSecret;
      if (Object.keys(config).length > 0) updateData.config = config;
      return updateIntegration(workspaceSlug, integration.id, updateData);
    },
    onSuccess: async () => {
      setBotToken('');
      setSigningSecret('');
      setSuccess('Slack integration updated successfully');
      // Refetch the integration (list + detail) to pick up the auto-retest status.
      await invalidateIntegration();
    },
    onError: (err) => {
      console.error('Failed to save integration:', err);
      setError('Failed to save integration');
    },
  });

  const testMutation = useMutation({
    mutationFn: () => {
      if (!integration) throw new Error('Missing integration');
      return testIntegration(workspaceSlug, integration.id);
    },
    onSuccess: async (result) => {
      setTestResult(result);
      if (result.status === 'active') {
        setSuccess('Connection test successful');
      } else {
        setError(`Connection test failed: ${result.error || 'Unknown error'}`);
      }
      // Refetch the integration (list + detail) to pick up the updated status.
      await invalidateIntegration();
    },
    onError: (err) => {
      console.error('Failed to test integration:', err);
      setError('Failed to test connection');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!integration) throw new Error('Missing integration');
      return deleteIntegration(workspaceSlug, integration.id);
    },
    onSuccess: async () => {
      await invalidateIntegration();
      navigate({
        to: '/w/$workspaceSlug/integrations',
        params: { workspaceSlug },
      });
    },
    onError: (err) => {
      console.error('Failed to delete integration:', err);
      setError('Failed to delete integration');
      setShowDeleteDialog(false);
    },
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  const handleSave = (e: React.FormEvent) => {
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

    if (mode === 'create') {
      createMutation.mutate();
    } else if (integration) {
      updateMutation.mutate();
    }
  };

  const handleTest = () => {
    if (!integration) return;
    setTestResult(null);
    setError('');
    setSuccess('');
    testMutation.mutate();
  };

  const handleDelete = () => {
    if (!integration) return;
    deleteMutation.mutate();
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

      {mode === 'edit' && integration && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Connection Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={integration.status} />
                    <span className="font-medium capitalize">{integration.status}</span>
                  </div>

                  {integration.lastTestedAt && (
                    <p className="text-sm text-muted-foreground">
                      Last tested: {new Date(integration.lastTestedAt).toLocaleString()}
                    </p>
                  )}

                  {integration.status === 'error' && integration.lastTestError && (
                    <p className="text-sm text-red-400">
                      Error: <code className="bg-red-500/10 border border-red-500/30 px-1 py-0.5 rounded">{integration.lastTestError}</code>
                    </p>
                  )}
                </div>

                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={testMutation.isPending}
                >
                  {testMutation.isPending ? 'Testing...' : 'Test Connection'}
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
                  disabled={deleteMutation.isPending}
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
              integrationName={integration.name}
              onConfirm={handleDelete}
              isDeleting={deleteMutation.isPending}
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
