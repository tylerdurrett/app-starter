import type { QueryClient } from '@tanstack/react-query';
import { clearActiveContext } from './active-workspace';

const authenticatedClientOwners = new WeakMap<QueryClient, string | null>();

/** Remove all state that may belong to the previously authenticated user. */
export function clearAuthenticatedClientState(
  queryClient: QueryClient,
  nextOwner?: string | null,
): void {
  queryClient.clear();
  clearActiveContext();
  if (nextOwner === undefined) {
    authenticatedClientOwners.delete(queryClient);
  } else {
    authenticatedClientOwners.set(queryClient, nextOwner);
  }
}

/**
 * Establish which session owns a client's private state, evicting stale state
 * before a different session can use it.
 */
export function establishAuthenticatedClientOwner(
  queryClient: QueryClient,
  userId: string | null,
): void {
  const hasOwner = authenticatedClientOwners.has(queryClient);
  if (
    (!hasOwner && userId === null) ||
    (hasOwner && authenticatedClientOwners.get(queryClient) !== userId)
  ) {
    clearAuthenticatedClientState(queryClient);
  }

  authenticatedClientOwners.set(queryClient, userId);
}
