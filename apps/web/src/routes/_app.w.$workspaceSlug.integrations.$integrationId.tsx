import { createFileRoute, getRouteApi, notFound } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { getIntegration } from '../lib/integrations';
import { getRegistryEntry } from '../integrations/registry';
import { queryKeys } from '../lib/query-keys';
import { ApiError } from '../lib/api';
import { AlertCircle } from 'lucide-react';

const workspaceRoute = getRouteApi('/_app/w/$workspaceSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/integrations/$integrationId')({
  // Loader gates only (ADR-0007): it fetches the integration solely to derive
  // its type -> registry entry (unknown type / 404 -> notFound) and returns
  // just the registry `entry`. The integration itself is server state the
  // component reads through TanStack Query, so no server data flows in as
  // loader render state. (Seeding the cache from here would require wiring
  // queryClient into the router context, which is out of scope and would
  // collide with sibling work on main.tsx; the loader's extra fetch for gating
  // is the accepted tradeoff.)
  loader: async ({ params }) => {
    try {
      const integration = await getIntegration(params.workspaceSlug, params.integrationId);
      const entry = getRegistryEntry(integration.type);
      if (!entry) {
        throw notFound();
      }
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
