import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Input,
  Label,
} from '@repo/ui';
import { createProject, type Project } from '../lib/projects';
import { workspaceProjectsQueryOptions } from '../lib/workspace-queries';

interface CreateProjectModalProps {
  workspaceSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: Project) => void;
}

export function CreateProjectModal({
  workspaceSlug,
  open,
  onOpenChange,
  onCreated,
}: CreateProjectModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const createInFlight = useRef(false);
  const projectsQueryOptions = workspaceProjectsQueryOptions(workspaceSlug);
  const createMutation = useMutation({
    mutationFn: (projectName: string) => createProject(workspaceSlug, projectName),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({
        queryKey: projectsQueryOptions.queryKey,
        exact: true,
      });
      onCreated(project);
      setName('');
      createMutation.reset();
      onOpenChange(false);
    },
    onSettled: () => {
      createInFlight.current = false;
    },
  });

  const reset = () => {
    setName('');
    createMutation.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || createInFlight.current) return;

    createInFlight.current = true;
    createMutation.reset();
    createMutation.mutate(trimmedName);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup>
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogTitle>Create project</DialogTitle>

            <div className="space-y-2">
              <Label htmlFor="create-project-name">Name</Label>
              <Input
                id="create-project-name"
                placeholder="e.g. Marketing site"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={createMutation.isPending}
                required
                autoFocus
              />
            </div>

            {createMutation.isError && (
              <div className="text-sm text-destructive" role="alert">
                Failed to create project
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={createMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || !name.trim()}
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
