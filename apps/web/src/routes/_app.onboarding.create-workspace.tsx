import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { createWorkspace } from '../lib/workspaces';

export const Route = createFileRoute('/_app/onboarding/create-workspace')({
  component: CreateWorkspacePage,
});

function CreateWorkspacePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const trimmedName = name.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedName) return;

    setError('');
    setIsLoading(true);

    try {
      const ws = await createWorkspace(trimmedName);
      await navigate({ to: '/w/$workspaceSlug', params: { workspaceSlug: ws.slug } });
    } catch {
      setError('Failed to create workspace. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl text-center">
              Create Your Workspace
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground text-center mb-6">
              Workspaces help you organize your projects and collaborate with your team.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="workspace-name">Workspace Name</Label>
                <Input
                  id="workspace-name"
                  type="text"
                  placeholder="My Workspace"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={isLoading}
                  autoFocus
                />
              </div>

              {error && (
                <div className="text-sm text-destructive text-center">
                  {error}
                </div>
              )}

              <Button
                className="w-full"
                disabled={isLoading || !trimmedName}
                onClick={handleSubmit as React.MouseEventHandler<HTMLButtonElement>}
              >
                {isLoading ? 'Creating...' : 'Create Workspace'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
