import { createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Label } from '@repo/ui';
import { ConfirmedDeleteSettings } from '../components/settings/confirmed-delete-settings';
import { InviteSettings } from '../components/settings/invite-settings';
import { MembershipSettings } from '../components/settings/membership-settings';
import { NameSettings } from '../components/settings/name-settings';
import { useSession } from '../lib/auth-client';
import { createProjectSettingsAdapters } from '../lib/project-settings-adapters';

const projectRoute = getRouteApi('/_app/w/$workspaceSlug/p/$projectSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/p/$projectSlug/settings')({
  component: ProjectSettingsPage,
});

export function ProjectSettingsPage() {
  // The parent loader remains the access gate and cache seed. Its effective
  // role already honors direct Membership precedence and Workspace override;
  // inaccessible Projects remain the parent's non-disclosing 404.
  const { project } = projectRoute.useLoaderData();
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const adapters = createProjectSettingsAdapters({
    workspaceSlug: project.workspaceSlug,
    projectSlug: project.slug,
    role: project.role,
    currentUserId: session.data?.user?.id,
    queryClient,
    navigate,
  });

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold">Settings</h1>
        <NameSettings adapter={adapters.name}>
          <div>
            <Label className="text-sm text-muted-foreground">Slug</Label>
            <p className="text-lg mt-1 text-muted-foreground">{project.slug}</p>
          </div>
        </NameSettings>
        <MembershipSettings adapter={adapters.membership} currentUserId={adapters.currentUserId} />
        <InviteSettings adapter={adapters.invites} />
        {adapters.canDelete && <ConfirmedDeleteSettings adapter={adapters.deletion} />}
      </div>
    </div>
  );
}
