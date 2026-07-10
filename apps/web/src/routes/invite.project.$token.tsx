import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { useSession, signOut } from '../lib/auth-client';
import { getProjectInviteByToken, acceptProjectInviteByToken } from '../lib/projects';
import { ApiError } from '../lib/api';
import type { ProjectInviteMetadata } from '../lib/projects';

export const Route = createFileRoute('/invite/project/$token')({
  loader: async ({ params }): Promise<ProjectInviteMetadata | null> => {
    try {
      return await getProjectInviteByToken(params.token);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
  component: ProjectInvitePage,
});

function ProjectInvitePage() {
  const invite = Route.useLoaderData();

  if (!invite) {
    return <TerminalCard title="Invite Not Found" message="This invite link is invalid or has been removed." />;
  }

  if (invite.status === 'revoked') {
    return (
      <TerminalCard
        title="Invite Revoked"
        message={<>This invite to <strong>{invite.projectName}</strong> has been revoked by the project owner.</>}
      />
    );
  }

  if (invite.status === 'accepted') {
    return (
      <TerminalCard
        title="Invite Already Accepted"
        message={<>This invite to <strong>{invite.projectName}</strong> has already been accepted.</>}
        linkTo="/w/$workspaceSlug/p/$projectSlug"
        linkParams={{ workspaceSlug: invite.workspaceSlug, projectSlug: invite.projectSlug }}
        linkLabel="Go to project"
      />
    );
  }

  if (new Date(invite.expiresAt) < new Date()) {
    return (
      <TerminalCard
        title="Invite Expired"
        message={<>This invite to <strong>{invite.projectName}</strong> has expired. Please ask the project owner to send a new invite.</>}
      />
    );
  }

  return <PendingInviteView invite={invite} />;
}

/** Handles the pending invite state — the only state that needs auth context. */
function PendingInviteView({ invite }: { invite: ProjectInviteMetadata }) {
  const { token } = Route.useParams();
  const session = useSession();
  const navigate = useNavigate();

  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState('');

  const userEmail = session.data?.user?.email?.toLowerCase().trim();
  const isLoggedIn = !!session.data?.user;
  const isCorrectEmail = isLoggedIn && userEmail === invite.email;
  const isWrongEmail = isLoggedIn && userEmail !== invite.email;

  const handleAccept = async () => {
    setAcceptError('');
    setIsAccepting(true);

    try {
      const result = await acceptProjectInviteByToken(token);
      await navigate({
        to: '/w/$workspaceSlug/p/$projectSlug',
        params: { workspaceSlug: invite.workspaceSlug, projectSlug: result.projectSlug },
      });
    } catch (err) {
      const message = err instanceof ApiError
        ? (err.parsedMessage || 'Failed to accept invite')
        : 'An unexpected error occurred';
      setAcceptError(message);
      setIsAccepting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    // useSession maintains internal state that doesn't clear on signOut alone
    window.location.reload();
  };

  return (
    <InviteShell>
      <CardHeader>
        <CardTitle className="text-2xl text-center">
          You've been invited
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground">
            You've been invited to join
          </p>
          <p className="text-lg font-semibold">{invite.projectName}</p>
          <p className="text-sm text-muted-foreground">
            in workspace <strong>{invite.workspaceName}</strong>
          </p>
          <p className="text-sm text-muted-foreground">
            Invite sent to <strong>{invite.email}</strong>
          </p>
        </div>

        {acceptError && (
          <div className="text-sm text-destructive text-center">
            {acceptError}
          </div>
        )}

        {!isLoggedIn && (
          <div className="space-y-3">
            <Link to="/login" search={{ redirectTo: `/invite/project/${token}` }}>
              <Button className="w-full">Sign in to accept</Button>
            </Link>
            <Link to="/register" search={{ redirectTo: `/invite/project/${token}` }}>
              <Button variant="outline" className="w-full">
                Create account to accept
              </Button>
            </Link>
          </div>
        )}

        {isCorrectEmail && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              Signed in as <strong>{userEmail}</strong>
            </p>
            <Button
              className="w-full"
              onClick={handleAccept}
              disabled={isAccepting}
            >
              {isAccepting ? 'Accepting...' : 'Accept invite'}
            </Button>
          </div>
        )}

        {isWrongEmail && (
          <div className="space-y-3">
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm text-center">
                You're signed in as <strong>{userEmail}</strong>, but this
                invite is for <strong>{invite.email}</strong>.
              </p>
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Sign out and use the correct account to accept this invite.
            </p>
            <Button variant="outline" className="w-full" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        )}
      </CardContent>
    </InviteShell>
  );
}

function TerminalCard({
  title,
  message,
  linkTo = '/',
  linkParams,
  linkLabel = 'Go to homepage',
}: {
  title: string;
  message: React.ReactNode;
  linkTo?: string;
  linkParams?: Record<string, string>;
  linkLabel?: string;
}) {
  return (
    <InviteShell>
      <CardHeader>
        <CardTitle className="text-2xl text-center">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground text-center">{message}</p>
        <div className="mt-6 text-center">
          <Link to={linkTo} params={linkParams} className="text-sm text-primary hover:underline">
            {linkLabel}
          </Link>
        </div>
      </CardContent>
    </InviteShell>
  );
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card>{children}</Card>
      </div>
    </div>
  );
}