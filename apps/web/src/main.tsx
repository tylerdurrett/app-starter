import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { routeTree } from './routeTree.gen';
import { authenticatedClientQueriesEnabled } from './lib/authenticated-client-state';
import './app.css';

// Create the query client first so it can be shared as router context: loaders
// seed the same cache (via context.queryClient) that the components read from
// through QueryClientProvider below (ADR-0007). The 30s staleTime keeps
// loader-seeded reads fresh on mount so they don't background-revalidate.
const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Better Auth owns focus/session refresh. Refetching private queries in
      // parallel can race a cross-tab identity change before it is reconciled.
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      enabled: (): boolean => authenticatedClientQueriesEnabled(queryClient),
    },
  },
});

// Create a new router instance
const router = createRouter({ routeTree, context: { queryClient } });

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
