import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { ShieldCheck } from 'lucide-react';
import { useSession } from '../lib/auth-client';
import { fetchOAuthClient, submitConsent } from '../lib/oauth-consent';
import { queryKeys } from '../lib/query-keys';

/** Human-readable descriptions for OAuth scopes */
const SCOPE_LABELS: Record<string, string> = {
  openid: 'Verify your identity',
  profile: 'Access your profile information',
  email: 'View your email address',
  offline_access: "Stay connected when you're not using the app",
  'workspaces:read': 'List the workspaces you belong to',
  'projects:read': 'List the projects you can access',
};

function humanizeScope(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}

export const Route = createFileRoute('/consent')({
  component: ConsentPage,
});

// Deriving clientId/scopes from the URL is not data fetching, so it stays a
// plain computed value rather than a loader or query.
function readConsentParams() {
  const params = new URLSearchParams(window.location.search);
  const scope = params.get('scope');
  return {
    clientId: params.get('client_id'),
    scopes: scope ? scope.split(' ').filter(Boolean) : [],
  };
}

function ConsentPage() {
  const session = useSession();
  const { clientId, scopes } = readConsentParams();

  // Loader-vs-query (ADR-0007): queries own non-gating server data; loaders gate
  // the render. The client-info read does NOT gate — the page renders correctly
  // without it (falling back to clientId as the name) and its errors are
  // non-fatal — so it's a useQuery, not a loader. The only "invalid request"
  // gate is the purely-local missing-clientId check below, which needs no fetch.
  const clientQuery = useQuery({
    queryKey: queryKeys.oauthClient(clientId ?? ''),
    queryFn: () => fetchOAuthClient(clientId as string),
    enabled: Boolean(session.data?.user && clientId),
  });
  const clientInfo = clientQuery.data ?? null;

  // Submit is a gating write, so it's a useMutation; on success we perform the
  // cross-origin redirect back to the OAuth client's callback.
  const consentMutation = useMutation({
    mutationFn: submitConsent,
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
  const isLoading = consentMutation.isPending;
  const error = consentMutation.error?.message ?? '';

  const handleConsent = (accept: boolean) => {
    consentMutation.mutate(accept);
  };

  if (!session.isPending && !session.data?.user) {
    return (
      <ConsentShell>
        <CardHeader>
          <CardTitle className="text-2xl text-center">Sign In Required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            You need to be signed in to authorize this application.
          </p>
          <Link to="/login">
            <Button className="w-full">Sign In</Button>
          </Link>
        </CardContent>
      </ConsentShell>
    );
  }

  if (!clientId) {
    return (
      <ConsentShell>
        <CardHeader>
          <CardTitle className="text-2xl text-center">Invalid Request</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive text-center">
            Missing client information. This consent page was accessed with an invalid URL.
          </p>
        </CardContent>
      </ConsentShell>
    );
  }

  if (session.isPending || clientQuery.isLoading) {
    return (
      <ConsentShell>
        <CardHeader>
          <CardTitle className="text-2xl text-center">Loading...</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center">
            Loading application details...
          </p>
        </CardContent>
      </ConsentShell>
    );
  }

  const displayName = clientInfo?.client_name || clientId;

  return (
    <ConsentShell>
      <CardHeader className="text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <ShieldCheck className="h-6 w-6 text-muted-foreground" />
        </div>
        <CardTitle className="text-2xl">Authorize {displayName}</CardTitle>
        <p className="text-sm text-muted-foreground">
          This application is requesting access to your account.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {scopes.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">This will allow the application to:</p>
            <ul className="space-y-2">
              {scopes.map((scope) => (
                <li key={scope} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {humanizeScope(scope)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {clientInfo?.policy_uri && (
          <p className="text-xs text-muted-foreground text-center">
            By allowing, you agree to the application&apos;s{' '}
            <a
              href={clientInfo.policy_uri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              privacy policy
            </a>
            {clientInfo.tos_uri && (
              <>
                {' '}
                and{' '}
                <a
                  href={clientInfo.tos_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  terms of service
                </a>
              </>
            )}
            .
          </p>
        )}

        {error && <div className="text-sm text-destructive text-center">{error}</div>}

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => handleConsent(false)}
            disabled={isLoading}
          >
            Deny
          </Button>
          <Button className="flex-1" onClick={() => handleConsent(true)} disabled={isLoading}>
            {isLoading ? 'Authorizing...' : 'Allow'}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Signed in as {session.data?.user?.email}
        </p>
      </CardContent>
    </ConsentShell>
  );
}

function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card>{children}</Card>
      </div>
    </div>
  );
}
