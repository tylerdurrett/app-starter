import { createFileRoute, getRouteApi, notFound } from '@tanstack/react-router';
import { getIntegration } from '../lib/integrations';
import { getRegistryEntry } from '../integrations/registry';
import { ApiError } from '../lib/api';

const workspaceRoute = getRouteApi('/_app/w/$workspaceSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/integrations/$integrationId')({
  loader: async ({ params }) => {
    try {
      const integration = await getIntegration(params.workspaceSlug, params.integrationId);
      const entry = getRegistryEntry(integration.type);
      if (!entry) {
        throw notFound();
      }
      return { integration, entry };
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
  const { integration, entry } = Route.useLoaderData();

  const SettingsComponent = entry.SettingsComponent;

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        <SettingsComponent
          mode="edit"
          workspaceSlug={workspace.slug}
          integration={integration}
        />
      </div>
    </div>
  );
}