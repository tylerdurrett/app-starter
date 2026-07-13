import type { QueryClient } from '@tanstack/react-query';
import { clearAuthenticatedClientState } from './authenticated-client-state';

interface NavigationTarget {
  to: string;
  params?: Record<string, string>;
}

interface CompleteLoginTransitionOptions {
  queryClient: QueryClient;
  externalRedirect: boolean;
  redirectTo?: string;
  navigate: (target: NavigationTarget) => Promise<unknown> | unknown;
  resolveDestination: (queryClient: QueryClient) => Promise<NavigationTarget>;
}

/** Clear the previous user's state before any successful login continuation. */
export async function completeLoginTransition({
  queryClient,
  externalRedirect,
  redirectTo,
  navigate,
  resolveDestination,
}: CompleteLoginTransitionOptions): Promise<void> {
  clearAuthenticatedClientState(queryClient);

  // Better Auth already initiated a full-page navigation for this branch.
  if (externalRedirect) return;

  if (redirectTo) {
    await navigate({ to: redirectTo });
    return;
  }

  await navigate(await resolveDestination(queryClient));
}

/** Clear private state only after sign-out succeeds, then reload or navigate. */
export async function completeSignOutTransition(
  queryClient: QueryClient,
  signOut: () => Promise<{ error?: unknown } | void>,
  continueAfterSignOut: () => Promise<unknown> | unknown,
): Promise<void> {
  const result = await signOut();
  if (result?.error) throw result.error;
  clearAuthenticatedClientState(queryClient);
  await continueAfterSignOut();
}
