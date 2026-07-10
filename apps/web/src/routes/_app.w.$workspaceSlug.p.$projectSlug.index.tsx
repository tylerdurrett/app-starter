import { createFileRoute, getRouteApi } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui';

const projectRoute = getRouteApi('/_app/w/$workspaceSlug/p/$projectSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/p/$projectSlug/')({
  component: ProjectDashboardPage,
});

function ProjectDashboardPage() {
  const { project } = projectRoute.useLoaderData();

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
          <p className="text-muted-foreground">
            {project.name} · you are a project {project.role}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Coming soon</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Project activity and key metrics will appear here.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
