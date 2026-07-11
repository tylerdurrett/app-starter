import { createFileRoute, Outlet, notFound } from '@tanstack/react-router';
import { getWorkspace } from '../lib/workspaces';
import { queryKeys } from '../lib/query-keys';
import { ApiError } from '../lib/api';

export const Route = createFileRoute('/_app/w/$workspaceSlug')({
  loader: async ({ params, context }) => {
    const { workspaceSlug } = params;
    try {
      const workspace = await getWorkspace(workspaceSlug);
      // Gate passed — seed the query cache so the component's useQuery reads
      // this same value (ADR-0007) and a rename's invalidation refreshes live.
      context.queryClient.setQueryData(queryKeys.workspace(workspaceSlug), workspace);
      return { workspace };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw notFound();
      }
      throw error;
    }
  },
  notFoundComponent: () => (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-2xl font-bold mb-2">Workspace not found</h1>
      <p className="text-muted-foreground">
        The workspace you're looking for doesn't exist or you don't have access to it.
      </p>
    </div>
  ),
  component: WorkspaceLayout,
});

function WorkspaceLayout() {
  // The parent /_app layout already provides the NavRail + main shell; this
  // route only contributes workspace-scoped loader data via its route context.
  return <Outlet />;
}