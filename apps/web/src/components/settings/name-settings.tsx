import { useState, type FormEvent, type ReactNode } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@repo/ui';
import { apiErrorMessage } from '../../lib/api';

type NamedResource = { name: string };

export interface NameSettingsAdapter<Resource extends NamedResource> {
  queryOptions: UseQueryOptions<Resource>;
  canEdit: boolean;
  inputPlaceholder: string;
  errorFallback: string;
  updateName: (name: string) => Promise<unknown>;
  refresh: (queryClient: QueryClient) => Promise<unknown>;
}

interface NameSettingsProps<Resource extends NamedResource> {
  adapter: NameSettingsAdapter<Resource>;
  children?: ReactNode;
}

export function NameSettings<Resource extends NamedResource>({
  adapter,
  children,
}: NameSettingsProps<Resource>) {
  const queryClient = useQueryClient();
  const resourceQuery = useQuery(adapter.queryOptions);
  const resourceName = resourceQuery.data?.name ?? '';
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState('');
  const renameMutation = useMutation({
    mutationFn: adapter.updateName,
    onSuccess: async () => {
      await adapter.refresh(queryClient);
      setIsEditing(false);
    },
  });

  const openEditor = () => {
    setName(resourceName);
    renameMutation.reset();
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setName('');
    renameMutation.reset();
    setIsEditing(false);
  };

  const saveName = (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || renameMutation.isPending) return;
    renameMutation.mutate(trimmedName);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-sm text-muted-foreground">Name</Label>
          {!isEditing ? (
            <div className="flex items-center justify-between mt-1">
              <p className="text-lg">{resourceName}</p>
              {adapter.canEdit && (
                <Button variant="outline" size="sm" onClick={openEditor}>
                  Edit
                </Button>
              )}
            </div>
          ) : (
            <form onSubmit={saveName} className="mt-2 space-y-2">
              <Input
                type="text"
                aria-label="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={adapter.inputPlaceholder}
                disabled={renameMutation.isPending}
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={renameMutation.isPending || !name.trim()}>
                  {renameMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelEditing}
                  disabled={renameMutation.isPending}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>

        {renameMutation.isError && (
          <p className="text-sm text-destructive" role="alert">
            {apiErrorMessage(renameMutation.error, adapter.errorFallback)}
          </p>
        )}
        {renameMutation.isSuccess && !isEditing && (
          <p className="text-sm text-green-600" role="status">
            Name updated
          </p>
        )}

        {children}
      </CardContent>
    </Card>
  );
}
