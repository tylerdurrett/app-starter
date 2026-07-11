import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { canWorkspace } from '../lib/permissions';
import { listIntegrations, deleteIntegration, type MaskedIntegration } from '../lib/integrations';
import { queryKeys } from '../lib/query-keys';
import { Plus, ExternalLink, AlertCircle, CheckCircle, Clock, KeyRound, Trash2 } from 'lucide-react';
import { IntegrationPickerDialog } from '../components/integration-picker-dialog';
import { DeleteIntegrationDialog } from '../components/delete-integration-dialog';

const workspaceRoute = getRouteApi('/_app/w/$workspaceSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/integrations/')({
  component: IntegrationsListPage,
});

function IntegrationsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workspace } = workspaceRoute.useLoaderData();
  const { role } = workspace;
  // Dialog/picker/delete-target selection is UI state and stays local.
  const [showPicker, setShowPicker] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MaskedIntegration | null>(null);

  // The integration list is server state — read it through the shared query key.
  const integrationsQuery = useQuery({
    queryKey: queryKeys.integrations(workspace.slug),
    queryFn: () => listIntegrations(workspace.slug),
  });
  const integrations = integrationsQuery.data ?? [];

  // Delete invalidates the list so it reflects the change without a manual reload.
  const deleteMutation = useMutation({
    mutationFn: (integrationId: string) => deleteIntegration(workspace.slug, integrationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.integrations(workspace.slug) });
      setDeleteTarget(null);
    },
  });

  function handleIntegrationTypeSelected(type: string) {
    setShowPicker(false);
    navigate({
      to: '/w/$workspaceSlug/integrations/new/$type',
      params: { workspaceSlug: workspace.slug, type },
    });
  }

  function handleIntegrationClick(integrationId: string) {
    navigate({
      to: '/w/$workspaceSlug/integrations/$integrationId',
      params: { workspaceSlug: workspace.slug, integrationId },
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id);
  }

  if (integrationsQuery.isLoading) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center py-12">
            <div className="text-muted-foreground">Loading integrations...</div>
          </div>
        </div>
      </div>
    );
  }

  if (integrationsQuery.isError) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center py-12">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <div className="text-red-600">Failed to load integrations</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Integrations</h1>
            <p className="text-muted-foreground mt-1">
              Connect {workspace.name} to external services
            </p>
          </div>
          {canWorkspace(role, 'integrations:manage') && (
            <Button onClick={() => setShowPicker(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Integration
            </Button>
          )}
        </div>

        {integrations.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <div className="text-muted-foreground mb-4">
                No integrations configured yet
              </div>
              {canWorkspace(role, 'integrations:manage') && (
                <Button onClick={() => setShowPicker(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Integration
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {integrations.map((integration) => {
              const unreadable = !integration.credentialsReadable;
              return (
                <Card
                  key={integration.id}
                  className={unreadable ? '' : 'cursor-pointer hover:shadow-lg transition-shadow'}
                  onClick={unreadable ? undefined : () => handleIntegrationClick(integration.id)}
                >
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className="text-2xl">💬</div>
                        <div>
                          <CardTitle>{integration.name}</CardTitle>
                          <div className="text-sm text-muted-foreground mt-1">
                            {integration.type.charAt(0).toUpperCase() + integration.type.slice(1)} Integration
                          </div>
                        </div>
                      </div>
                      {unreadable ? <UnreadableBadge /> : <StatusBadge status={integration.status} />}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {unreadable ? (
                      <div className="space-y-3">
                        <div className="text-sm text-amber-700">
                          This integration's credentials can't be read with the current encryption key.
                          Delete and re-create it to fix.
                        </div>
                        {canWorkspace(role, 'integrations:manage') && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(integration);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </Button>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between items-center text-sm">
                          <div className="text-muted-foreground">
                            {integration.lastTestedAt ? (
                              <>
                                Last tested: {new Date(integration.lastTestedAt).toLocaleString()}
                              </>
                            ) : (
                              'Never tested'
                            )}
                          </div>
                          <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        </div>
                        {integration.lastTestError && (
                          <div className="mt-2 text-sm text-red-600">
                            Error: {integration.lastTestError}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {showPicker && (
          <IntegrationPickerDialog
            open={showPicker}
            onOpenChange={setShowPicker}
            onSelect={handleIntegrationTypeSelected}
          />
        )}

        {deleteMutation.isError && (
          <div className="text-sm text-red-600">
            Failed to delete integration. Check the server logs.
          </div>
        )}

        <DeleteIntegrationDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          integrationName={deleteTarget?.name ?? ''}
          isDeleting={deleteMutation.isPending}
          onConfirm={confirmDelete}
        />
      </div>
    </div>
  );
}

function UnreadableBadge() {
  return (
    <div className="flex items-center gap-1 text-sm text-amber-700 bg-amber-50 px-2 py-1 rounded">
      <KeyRound className="h-3 w-3" />
      Credentials unreadable
    </div>
  );
}

function StatusBadge({ status }: { status: MaskedIntegration['status'] }) {
  if (status === 'active') {
    return (
      <div className="flex items-center gap-1 text-sm text-green-600 bg-green-50 px-2 py-1 rounded">
        <CheckCircle className="h-3 w-3" />
        Active
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex items-center gap-1 text-sm text-red-600 bg-red-50 px-2 py-1 rounded">
        <AlertCircle className="h-3 w-3" />
        Error
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-sm text-yellow-600 bg-yellow-50 px-2 py-1 rounded">
      <Clock className="h-3 w-3" />
      Pending
    </div>
  );
}