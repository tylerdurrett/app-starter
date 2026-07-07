import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { authClient } from '../lib/auth-client';
import { resolveProject } from '../lib/project-resolver';

interface AuthSearch {
  redirectTo?: string;
}

export const Route = createFileRoute('/_auth')({
  validateSearch: (search: Record<string, unknown>): AuthSearch => {
    const raw = typeof search.redirectTo === 'string' ? search.redirectTo : undefined;
    // Only allow relative same-origin paths to prevent open redirect attacks
    const redirectTo = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : undefined;
    return { redirectTo };
  },
  beforeLoad: async ({ search }) => {
    const { data } = await authClient.getSession();
    if (data) {
      if (search.redirectTo) {
        throw redirect({ to: search.redirectTo });
      }
      const target = await resolveProject();
      throw redirect({ to: target.to, params: target.params });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Outlet />
      </div>
    </div>
  );
}
