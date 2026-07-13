import { createFileRoute, Link, useNavigate, getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { signIn } from '../../lib/auth-client';
import { resolveProject } from '../../lib/project-resolver';
import { completeLoginTransition } from '../../lib/auth-transitions';

const authRoute = getRouteApi('/_auth');

export const Route = createFileRoute('/_auth/login')({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { redirectTo } = authRoute.useSearch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await signIn.email({
        email,
        password,
      });

      if (response.error) {
        setError(response.error.message || 'Invalid email or password');
        setIsLoading(false);
        return;
      }

      await completeLoginTransition({
        queryClient,
        userId: response.data!.user.id,
        externalRedirect: Boolean(response.data?.redirect && response.data?.url),
        redirectTo,
        navigate: (target) => navigate(target),
        resolveDestination: resolveProject,
      });
    } catch {
      setError('An unexpected error occurred. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl text-center">Sign In</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                to="/forgot-password"
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="text-sm text-destructive text-center">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Signing in...' : 'Sign In'}
          </Button>

          <div className="text-center text-sm text-muted-foreground">
            Don't have an account?{' '}
            <Link
              to="/register"
              search={{ redirectTo }}
              className="text-primary hover:underline"
            >
              Register
            </Link>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
