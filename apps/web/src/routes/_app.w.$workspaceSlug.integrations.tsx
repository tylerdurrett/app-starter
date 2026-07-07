import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/w/$workspaceSlug/integrations')({
  component: IntegrationsLayout,
});

function IntegrationsLayout() {
  return <Outlet />;
}
