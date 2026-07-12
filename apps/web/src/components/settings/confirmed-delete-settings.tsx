import { useState, type FormEvent } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { apiErrorMessage } from '../../lib/api';

export interface ConfirmedDeleteSettingsAdapter<Resource> {
  queryOptions: UseQueryOptions<Resource>;
  getName: (resource: Resource) => string;
  title: string;
  consequence: string;
  revealButton: string;
  confirmButton: string;
  pendingButton: string;
  deletedButton: string;
  errorFallback: string;
  deleteResource: (confirmation: string) => Promise<void>;
  refreshAfterDelete: (queryClient: QueryClient) => Promise<unknown>;
  onDeleted: () => Promise<void>;
}

export function ConfirmedDeleteSettings<Resource>({
  adapter,
}: {
  adapter: ConfirmedDeleteSettingsAdapter<Resource>;
}) {
  const queryClient = useQueryClient();
  const resourceQuery = useQuery(adapter.queryOptions);
  const resourceName = resourceQuery.data ? adapter.getName(resourceQuery.data) : '';
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [deletionCommitted, setDeletionCommitted] = useState(false);
  const [postDeletePending, setPostDeletePending] = useState(false);
  const [destinationFailed, setDestinationFailed] = useState(false);
  const expectedConfirmation = `Delete ${resourceName}`;
  const isExactConfirmation =
    resourceName.length > 0 && confirmation === expectedConfirmation;

  const deleteMutation = useMutation({
    mutationFn: (submittedConfirmation: string) =>
      adapter.deleteResource(submittedConfirmation),
    onSuccess: async () => {
      // The destructive write has committed. Cache refresh is best-effort, but
      // the destination must still run so a stale cache cannot strand the user
      // on a deleted resource. Neither follow-up failure makes delete retryable.
      setDeletionCommitted(true);
      setPostDeletePending(true);
      try {
        await adapter.refreshAfterDelete(queryClient);
      } catch {
        // Navigation is the safe recovery path after a successful deletion.
      } finally {
        try {
          await adapter.onDeleted();
        } catch {
          setDestinationFailed(true);
        } finally {
          setPostDeletePending(false);
        }
      }
    },
  });

  const controlsLocked = deleteMutation.isPending || deletionCommitted;

  const revealConfirmation = () => {
    setConfirmation('');
    deleteMutation.reset();
    setIsConfirming(true);
  };

  const cancelConfirmation = () => {
    if (controlsLocked) return;
    setIsConfirming(false);
    setConfirmation('');
    deleteMutation.reset();
  };

  const handleDelete = (event: FormEvent) => {
    event.preventDefault();
    if (controlsLocked || !isExactConfirmation) return;
    deleteMutation.mutate(confirmation);
  };

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent>
        {!isConfirming ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{adapter.title}</p>
              <p className="text-xs text-muted-foreground">{adapter.consequence}</p>
            </div>
            <Button variant="destructive" size="sm" onClick={revealConfirmation}>
              {adapter.revealButton}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleDelete} className="space-y-3">
            <p className="text-sm">
              Type{' '}
              <code className="bg-muted px-1 py-0.5 rounded text-xs">
                {expectedConfirmation}
              </code>{' '}
              to confirm.
            </p>
            <Label htmlFor="delete-confirmation">Confirmation</Label>
            <Input
              id="delete-confirmation"
              type="text"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="Enter confirmation text"
              disabled={controlsLocked}
              autoFocus
            />
            {deleteMutation.isError && (
              <p className="text-sm text-destructive" role="alert">
                {apiErrorMessage(deleteMutation.error, adapter.errorFallback)}
              </p>
            )}
            {destinationFailed && (
              <p className="text-sm text-destructive" role="alert">
                The resource was deleted, but the next page could not be opened. Reload to
                continue.
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={controlsLocked || !isExactConfirmation}
              >
                {deleteMutation.isPending || postDeletePending
                  ? adapter.pendingButton
                  : deletionCommitted
                    ? adapter.deletedButton
                    : adapter.confirmButton}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cancelConfirmation}
                disabled={controlsLocked}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
