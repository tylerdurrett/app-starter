import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { authClient } from '../lib/auth-client';
import { establishAuthenticatedClientOwner } from '../lib/authenticated-client-state';
import { NavRail } from '../components/nav-rail';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    const { data } = await authClient.getSession();
    establishAuthenticatedClientOwner(context.queryClient, data?.user.id ?? null);
    if (!data) {
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
