import { createFileRoute, getRouteApi } from '@tanstack/react-router';
import { WorkspaceSettings } from '../components/settings/workspace-settings';

const workspaceRoute = getRouteApi('/_app/w/$workspaceSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/settings')({
  component: WorkspaceSettingsPage,
});

function WorkspaceSettingsPage() {
  // Loader data remains the access gate; mutable fields are observed through
  // the shared workflows' Query adapters.
  const { workspace } = workspaceRoute.useLoaderData();

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Workspace Settings</h1>
        <WorkspaceSettings workspaceSlug={workspace.slug} role={workspace.role} />
      </div>
    </div>
  );
}
