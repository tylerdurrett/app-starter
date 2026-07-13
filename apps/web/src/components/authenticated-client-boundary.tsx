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
    if (session.isPending || validatedOwner === userId) return;

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
  }, [queryClient, router, session.isPending, userId, validatedOwner]);

  if (session.isPending && validatedOwner === undefined) return null;
  if (!session.isPending && (userId === null || validatedOwner !== userId)) return null;
  return children;
}
