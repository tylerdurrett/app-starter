import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { createWorkspace } from '../lib/workspaces';
import { workspacesQueryOptions } from '../lib/workspace-queries';

export const Route = createFileRoute('/_app/onboarding/create-workspace')({
  component: CreateWorkspacePage,
});

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const trimmedName = name.trim();
  const workspaceListQueryOptions = workspacesQueryOptions();
  const createMutation = useMutation({
    mutationFn: (workspaceName: string) => createWorkspace(workspaceName),
    onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({
        queryKey: workspaceListQueryOptions.queryKey,
        exact: true,
      });
      await navigate({
        to: '/w/$workspaceSlug',
        params: { workspaceSlug: workspace.slug },
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedName) return;

    createMutation.reset();
    createMutation.mutate(trimmedName);
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
                  disabled={createMutation.isPending}
                  autoFocus
                />
              </div>

              {createMutation.isError && (
                <div className="text-sm text-destructive text-center" role="alert">
                  Failed to create workspace. Please try again.
                </div>
              )}

              <Button
                className="w-full"
                type="submit"
                disabled={createMutation.isPending || !trimmedName}
              >
                {createMutation.isPending ? 'Creating...' : 'Create Workspace'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
