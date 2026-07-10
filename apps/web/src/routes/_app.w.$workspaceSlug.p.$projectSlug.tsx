import { createFileRoute, Outlet, notFound, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@repo/ui';
import { getProject } from '../lib/projects';
import { ApiError } from '../lib/api';
import { resolveProject } from '../lib/project-resolver';

export const Route = createFileRoute('/_app/w/$workspaceSlug/p/$projectSlug')({
  loader: async ({ params }) => {
    try {
      const project = await getProject(params.projectSlug);
      return { project };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw notFound();
      }
      throw error;
    }
  },
  notFoundComponent: ProjectNotFound,
  component: ProjectLayout,
});

function ProjectLayout() {
  return <Outlet />;
}

function ProjectNotFound() {
  const navigate = useNavigate();
  const [isNavigating, setIsNavigating] = useState(false);

  const handleGoHome = async () => {
    setIsNavigating(true);
    try {
      const target = await resolveProject();
      await navigate(target);
    } catch {
      setIsNavigating(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md space-y-4">
        <div className="text-6xl font-bold text-muted-foreground">404</div>
        <h1 className="text-2xl font-semibold">Project not found</h1>
        <p className="text-muted-foreground">
          This project doesn&apos;t exist or you don&apos;t have access to it.
        </p>
        <Button variant="outline" onClick={handleGoHome} disabled={isNavigating}>
          {isNavigating ? 'Redirecting...' : 'Go to your project'}
        </Button>
      </div>
    </div>
  );
}