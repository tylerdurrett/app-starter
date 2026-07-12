import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';

function structuredErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;

  // ApiError exposes the server's `{ error: { message } }` payload through
  // parsedMessage. The structural check keeps this workflow independent of
  // the HTTP client while preserving its safe, user-facing error text.
  if ('parsedMessage' in error && typeof error.parsedMessage === 'string') {
    return error.parsedMessage.trim() || fallback;
  }

  return fallback;
}

export interface ConfirmedDeleteSettingsAdapter {
  /** The current name from the resource's live Query observer. */
  resourceName: string;
  title: string;
  consequence: string;
  revealButton: string;
  confirmButton: string;
  pendingButton: string;
  errorFallback: string;
  deleteResource: (confirmation: string) => Promise<void>;
  refreshAfterDelete: () => Promise<void>;
  onDeleted: () => Promise<void>;
}

export function ConfirmedDeleteSettings({
  adapter,
}: {
  adapter: ConfirmedDeleteSettingsAdapter;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const expectedConfirmation = `Delete ${adapter.resourceName}`;
  const isExactConfirmation =
    adapter.resourceName.length > 0 && confirmation === expectedConfirmation;

  const deleteMutation = useMutation({
    mutationFn: (submittedConfirmation: string) =>
      adapter.deleteResource(submittedConfirmation),
    onSuccess: async () => {
      await adapter.refreshAfterDelete();
      await adapter.onDeleted();
    },
  });

  const revealConfirmation = () => {
    setConfirmation('');
    deleteMutation.reset();
    setIsConfirming(true);
  };

  const cancelConfirmation = () => {
    if (deleteMutation.isPending) return;
    setIsConfirming(false);
    setConfirmation('');
    deleteMutation.reset();
  };

  const handleDelete = (event: FormEvent) => {
    event.preventDefault();
    if (deleteMutation.isPending || !isExactConfirmation) return;
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
              disabled={deleteMutation.isPending}
              autoFocus
            />
            {deleteMutation.isError && (
              <p className="text-sm text-destructive" role="alert">
                {structuredErrorMessage(deleteMutation.error, adapter.errorFallback)}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={deleteMutation.isPending || !isExactConfirmation}
              >
                {deleteMutation.isPending ? adapter.pendingButton : adapter.confirmButton}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cancelConfirmation}
                disabled={deleteMutation.isPending}
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
