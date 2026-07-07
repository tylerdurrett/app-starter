import { useState } from 'react';
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
  const [name, setName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setName('');
    setError('');
    setIsCreating(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    setError('');
    setIsCreating(true);
    try {
      const project = await createProject(workspaceSlug, trimmedName);
      onCreated(project);
      reset();
      onOpenChange(false);
    } catch {
      setError('Failed to create project');
      setIsCreating(false);
    }
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
                disabled={isCreating}
                required
                autoFocus
              />
            </div>

            {error && <div className="text-sm text-destructive">{error}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating || !name.trim()}>
                {isCreating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}
