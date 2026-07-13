import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  queryClient: { invalidateQueries: vi.fn() },
  createAdapters: vi.fn(),
  project: {
    workspaceSlug: 'acme',
    slug: 'roadmap',
    role: 'owner' as const,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  getRouteApi: () => ({ useLoaderData: () => ({ project: mocks.project }) }),
  useNavigate: () => mocks.navigate,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mocks.queryClient,
}));

vi.mock('../lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'signed-in-user' } } }),
}));

vi.mock('../lib/project-settings-adapters', () => ({
  createProjectSettingsAdapters: mocks.createAdapters,
}));

vi.mock('../components/settings/name-settings', () => ({
  NameSettings: ({ children }: { children: ReactNode }) => (
    <section data-testid="name-workflow">{children}</section>
  ),
}));

vi.mock('../components/settings/membership-settings', () => ({
  MembershipSettings: ({ currentUserId }: { currentUserId?: string }) => (
    <section data-testid="membership-workflow">{currentUserId}</section>
  ),
}));

vi.mock('../components/settings/invite-settings', () => ({
  InviteSettings: () => <section data-testid="invite-workflow" />,
}));

vi.mock('../components/settings/confirmed-delete-settings', () => ({
  ConfirmedDeleteSettings: () => <section data-testid="delete-workflow" />,
}));

import { ProjectSettingsPage } from './_app.w.$workspaceSlug.p.$projectSlug.settings';

describe('ProjectSettingsPage composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdapters.mockReturnValue({
      name: {},
      membership: {},
      invites: {},
      deletion: {},
      currentUserId: 'signed-in-user',
      canDelete: true,
    });
  });

  it('binds loader gating values, the current session, Query client, and router destination', () => {
    render(<ProjectSettingsPage />);

    expect(mocks.createAdapters).toHaveBeenCalledWith({
      workspaceSlug: 'acme',
      projectSlug: 'roadmap',
      role: 'owner',
      currentUserId: 'signed-in-user',
      queryClient: mocks.queryClient,
      navigate: mocks.navigate,
    });
    expect(screen.getByTestId('membership-workflow')).toHaveTextContent('signed-in-user');
  });

  it('composes all four shared workflows and preserves Project slug content', () => {
    render(<ProjectSettingsPage />);

    expect(screen.getByTestId('name-workflow')).toHaveTextContent('Slug');
    expect(screen.getByTestId('name-workflow')).toHaveTextContent('roadmap');
    expect(screen.getByTestId('membership-workflow')).toBeInTheDocument();
    expect(screen.getByTestId('invite-workflow')).toBeInTheDocument();
    expect(screen.getByTestId('delete-workflow')).toBeInTheDocument();
  });

  it('omits deletion when the effective Project role lacks permission', () => {
    mocks.createAdapters.mockReturnValue({
      name: {},
      membership: {},
      invites: {},
      deletion: {},
      currentUserId: 'signed-in-user',
      canDelete: false,
    });

    render(<ProjectSettingsPage />);

    expect(screen.queryByTestId('delete-workflow')).not.toBeInTheDocument();
  });
});
