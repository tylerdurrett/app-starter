import type { QueryClient } from '@tanstack/react-query';
import { clearActiveContext } from './active-workspace';

/** Remove all state that may belong to the previously authenticated user. */
export function clearAuthenticatedClientState(queryClient: QueryClient): void {
  queryClient.clear();
  clearActiveContext();
}
