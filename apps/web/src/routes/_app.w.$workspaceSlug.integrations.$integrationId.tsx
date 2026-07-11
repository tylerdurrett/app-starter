import { createFileRoute, getRouteApi, notFound } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { getIntegration } from '../lib/integrations';
import { getRegistryEntry } from '../integrations/registry';
import { queryKeys } from '../lib/query-keys';
import { ApiError } from '../lib/api';
import { AlertCircle } from 'lucide-react';

const workspaceRoute = getRouteApi('/_app/w/$workspaceSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/integrations/$integrationId')({
  // Loader gates AND seeds (ADR-0007): it fetches the integration once to
  // derive its type -> registry entry (unknown type / 404 -> notFound) and
  // seeds that same fetched value into the query cache, so the component's
  // useQuery hits the cache instead of re-fetching. Only the gating-derived
  // registry `entry` (non-mutating) flows in as loader render state.
  loader: async ({ params, context }) => {
    try {
      const integration = await getIntegration(params.workspaceSlug, params.integrationId);
      const entry = getRegistryEntry(integration.type);
      if (!entry) {
        throw notFound();
      }
      context.queryClient.setQueryData(
        queryKeys.integration(params.workspaceSlug, params.integrationId),
        integration,
      );
      return { entry };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw notFound();
      }
      throw error;
    }
  },
  component: IntegrationDetailPage,
});

function IntegrationDetailPage() {
  const { workspace } = workspaceRoute.useLoaderData();
  const { integrationId } = Route.useParams();
  const { entry } = Route.useLoaderData();

  // The integration is server state — read it through the shared query key.
  const integrationQuery = useQuery({
    queryKey: queryKeys.integration(workspace.slug, integrationId),
    queryFn: () => getIntegration(workspace.slug, integrationId),
  });

  const SettingsComponent = entry.SettingsComponent;

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        {integrationQuery.isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading integration...</div>
        ) : integrationQuery.isError || !integrationQuery.data ? (
          <div className="text-center py-12">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <div className="text-red-600">Failed to load integration</div>
          </div>
        ) : (
          <SettingsComponent
            mode="edit"
            workspaceSlug={workspace.slug}
            integration={integrationQuery.data}
          />
        )}
      </div>
    </div>
  );
}
