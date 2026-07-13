import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useSession } from '../lib/auth-client';
import {
  authenticatedClientOwnerMatches,
  establishAuthenticatedClientOwner,
} from '../lib/authenticated-client-state';

export function AuthenticatedClientBoundary({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const ownerMatches = authenticatedClientOwnerMatches(queryClient, userId);
  const [validatedOwner, setValidatedOwner] = useState<string | null | undefined>(() =>
    ownerMatches && userId !== null ? userId : undefined,
  );

  useEffect(() => {
    if (session.isPending || session.isRefetching) return;
    if (validatedOwner === userId) {
      // A route observation can establish the next owner before the reactive
      // session catches up. The render gate below hides this stale identity;
      // do not let it reclaim the client from the newer observation.
      return;
    }

    let active = true;
    void establishAuthenticatedClientOwner(queryClient, userId).then(async () => {
      if (!active) return;
      if (userId === null) {
        await router.navigate({ to: '/login' });
        return;
      }
      await router.invalidate();
      if (active) setValidatedOwner(userId);
    });

    return () => {
      active = false;
    };
  }, [queryClient, router, session.isPending, session.isRefetching, userId, validatedOwner]);

  if (session.isPending || session.isRefetching) return null;
  if (userId === null || validatedOwner !== userId || !ownerMatches) return null;
  return children;
}
