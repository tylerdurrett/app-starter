import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { UserMinus } from 'lucide-react';
import { apiErrorMessage } from '../../lib/api';
import { authenticatedQueryEnabled } from '../../lib/authenticated-client-state';

export interface MembershipMember {
  userId: string;
  name: string;
  email: string;
  role: string;
}

export interface MembershipSettingsAdapter<Member extends MembershipMember> {
  queryKey: QueryKey;
  listMembers: () => Promise<Member[]>;
  removeMember: (userId: string) => Promise<void>;
  canList: boolean;
  canRemove: (member: Member) => boolean;
}

interface MembershipSettingsProps<Member extends MembershipMember> {
  adapter: MembershipSettingsAdapter<Member>;
  currentUserId?: string;
}

export function MembershipSettings<Member extends MembershipMember>({
  adapter,
  currentUserId,
}: MembershipSettingsProps<Member>) {
  const queryClient = useQueryClient();
  const membersQuery = useQuery({
    queryKey: adapter.queryKey,
    queryFn: () => adapter.listMembers(),
    enabled: authenticatedQueryEnabled(queryClient, adapter.canList),
  });
  const [pendingRemovalIds, setPendingRemovalIds] = useState<ReadonlySet<string>>(new Set());
  const [removalErrors, setRemovalErrors] = useState<ReadonlyMap<string, unknown>>(new Map());
  const pendingRemovalIdsRef = useRef(new Set<string>());
  const removeMutation = useMutation({
    mutationFn: (userId: string) => adapter.removeMember(userId),
    onSuccess: async () => {
      await membersQuery.refetch();
    },
    onError: (error, userId) => {
      setRemovalErrors((errors) => new Map(errors).set(userId, error));
    },
    onSettled: (_data, _error, userId) => {
      pendingRemovalIdsRef.current.delete(userId);
      setPendingRemovalIds(new Set(pendingRemovalIdsRef.current));
    },
  });

  const members = membersQuery.data ?? [];

  const handleRemove = (userId: string) => {
    if (pendingRemovalIdsRef.current.has(userId)) return;

    pendingRemovalIdsRef.current.add(userId);
    setPendingRemovalIds(new Set(pendingRemovalIdsRef.current));
    setRemovalErrors((errors) => {
      if (!errors.has(userId)) return errors;
      const nextErrors = new Map(errors);
      nextErrors.delete(userId);
      return nextErrors;
    });
    removeMutation.mutate(userId);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
      </CardHeader>
      <CardContent>
        {!adapter.canList && (
          <p className="text-sm text-muted-foreground">
            You don't have permission to view members.
          </p>
        )}
        {adapter.canList && membersQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Loading...</p>
        )}
        {adapter.canList && membersQuery.isError && (
          <p className="text-sm text-destructive">
            {apiErrorMessage(membersQuery.error, 'Failed to load members')}
          </p>
        )}
        {adapter.canList &&
          !membersQuery.isLoading &&
          !membersQuery.isError &&
          members.length === 0 && <p className="text-sm text-muted-foreground">No members yet.</p>}
        {adapter.canList &&
          !membersQuery.isLoading &&
          !membersQuery.isError &&
          members.length > 0 && (
            <ul className="divide-y divide-border">
              {members.map((member) => {
                const isCurrentUser = member.userId === currentUserId;
                const isRemoving = pendingRemovalIds.has(member.userId);
                const removalError = removalErrors.get(member.userId);
                const canRemove =
                  currentUserId !== undefined && !isCurrentUser && adapter.canRemove(member);

                return (
                  <li key={member.userId} className="flex items-center justify-between py-3">
                    <div>
                      <p className="text-sm font-medium">
                        {member.name}
                        {isCurrentUser && <span className="text-muted-foreground ml-1">(you)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                      {removalError !== undefined && (
                        <p className="text-sm text-destructive">
                          {apiErrorMessage(removalError, `Failed to remove ${member.name}`)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground capitalize">
                        {member.role}
                      </span>
                      {canRemove && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemove(member.userId)}
                          disabled={isRemoving}
                          title={isRemoving ? `Removing ${member.name}` : `Remove ${member.name}`}
                        >
                          <UserMinus className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </CardContent>
    </Card>
  );
}
