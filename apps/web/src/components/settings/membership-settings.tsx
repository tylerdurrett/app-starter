import { useMutation, useQuery, type QueryKey } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { UserMinus } from 'lucide-react';
import { apiErrorMessage } from '../../lib/api';

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
  const membersQuery = useQuery({
    queryKey: adapter.queryKey,
    queryFn: () => adapter.listMembers(),
    enabled: adapter.canList,
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => adapter.removeMember(userId),
    onSuccess: async () => {
      await membersQuery.refetch();
    },
  });

  const members = membersQuery.data ?? [];

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
        {removeMutation.isError && (
          <p className="text-sm text-destructive">
            {apiErrorMessage(removeMutation.error, 'Failed to remove member')}
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
                const isRemoving =
                  removeMutation.isPending && removeMutation.variables === member.userId;
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
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground capitalize">
                        {member.role}
                      </span>
                      {canRemove && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeMutation.mutate(member.userId)}
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
