import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { authClient } from '../lib/auth-client';
import { observeAuthenticatedSession } from '../lib/authenticated-client-state';
import { AuthenticatedClientBoundary } from '../components/authenticated-client-boundary';
import { NavRail } from '../components/nav-rail';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    const session = await observeAuthenticatedSession(context.queryClient, async () => {
      const { data } = await authClient.getSession();
      return data ? { userId: data.user.id } : null;
    });
    if (!session) {
      throw redirect({ to: '/login' });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <AuthenticatedClientBoundary>
      <div className="h-screen flex">
        <NavRail />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </AuthenticatedClientBoundary>
  );
}
