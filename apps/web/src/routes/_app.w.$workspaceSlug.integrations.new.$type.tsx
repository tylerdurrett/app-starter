import { createFileRoute, getRouteApi, notFound } from '@tanstack/react-router';
import { getRegistryEntry } from '../integrations/registry';

const workspaceRoute = getRouteApi('/_app/w/$workspaceSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/integrations/new/$type')({
  loader: ({ params }) => {
    const entry = getRegistryEntry(params.type);
    if (!entry) {
      throw notFound();
    }
    return { entry };
  },
  component: NewIntegrationPage,
});

function NewIntegrationPage() {
  const { workspace } = workspaceRoute.useLoaderData();
  const { entry } = Route.useLoaderData();

  const SettingsComponent = entry.SettingsComponent;

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        <SettingsComponent
          mode="create"
          workspaceSlug={workspace.slug}
        />
      </div>
    </div>
  );
}
