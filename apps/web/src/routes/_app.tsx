import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { authClient } from '../lib/auth-client';
import { clearAuthenticatedClientState } from '../lib/authenticated-client-state';
import { NavRail } from '../components/nav-rail';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    const { data } = await authClient.getSession();
    if (!data) {
      clearAuthenticatedClientState(context.queryClient);
      throw redirect({ to: '/login' });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <div className="h-screen flex">
      <NavRail />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
