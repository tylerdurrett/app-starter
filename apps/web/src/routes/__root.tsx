import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';

// The router carries the shared QueryClient in its context so loaders can seed
// the query cache their components read from (ADR-0007).
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <>
      <Outlet />
    </>
  ),
});
