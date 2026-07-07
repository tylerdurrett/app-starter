import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { authClient } from '../lib/auth-client';
import { NavRail } from '../components/nav-rail';

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
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
