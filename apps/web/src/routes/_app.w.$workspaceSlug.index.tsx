import { createFileRoute, Link, getRouteApi, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';
import { listProjectsForWorkspace, listWorkspaceMembers, type WorkspaceMember } from '../lib/workspaces';
import type { ProjectWithRole } from '../lib/projects';
import { canWorkspace } from '../lib/permissions';
import { CreateProjectModal } from '../components/create-project-modal';
import { Plus } from 'lucide-react';

const workspaceRoute = getRouteApi('/_app/w/$workspaceSlug');

export const Route = createFileRoute('/_app/w/$workspaceSlug/')({
  component: WorkspaceHomePage,
});

function WorkspaceHomePage() {
  const { workspace } = workspaceRoute.useLoaderData();
  const { role } = workspace;
  const navigate = useNavigate();

  const [projects, setProjects] = useState<ProjectWithRole[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [projectsError, setProjectsError] = useState('');
  const [membersError, setMembersError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    // Fetch projects
    listProjectsForWorkspace(workspace.slug)
      .then(setProjects)
      .catch(() => setProjectsError('Failed to load projects'))
      .finally(() => setLoadingProjects(false));

    // Fetch members
    if (canWorkspace(role, 'workspace:members:list')) {
      listWorkspaceMembers(workspace.slug)
        .then(setMembers)
        .catch(() => setMembersError('Failed to load members'))
        .finally(() => setLoadingMembers(false));
    } else {
      setLoadingMembers(false);
    }
  }, [workspace.slug, role]);

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">{workspace.name}</h1>
          <p className="text-muted-foreground">
            Manage your workspace projects and members
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Projects</CardTitle>
              {canWorkspace(role, 'projects:create') && (
                <Button size="sm" onClick={() => setShowCreateModal(true)}>
                  <Plus className="w-4 h-4 mr-1" />
                  Create project
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {loadingProjects && (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
              {projectsError && (
                <p className="text-sm text-destructive">{projectsError}</p>
              )}
              {!loadingProjects && !projectsError && projects.length === 0 && (
                <p className="text-sm text-muted-foreground">No projects yet.</p>
              )}
              {!loadingProjects && projects.length > 0 && (
                <ul className="space-y-2">
                  {projects.map((project) => (
                    <li key={project.id}>
                      <Link
                        to="/p/$projectSlug"
                        params={{ projectSlug: project.slug }}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent/50 transition-colors"
                      >
                        <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center text-sm font-semibold">
                          {project.name[0]?.toUpperCase() || 'P'}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">{project.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {project.role}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
            </CardHeader>
            <CardContent>
              {!canWorkspace(role, 'workspace:members:list') && (
                <p className="text-sm text-muted-foreground">
                  You don't have permission to view members.
                </p>
              )}
              {loadingMembers && canWorkspace(role, 'workspace:members:list') && (
                <p className="text-sm text-muted-foreground">Loading...</p>
              )}
              {membersError && (
                <p className="text-sm text-destructive">{membersError}</p>
              )}
              {!loadingMembers && !membersError && members.length === 0 && (
                <p className="text-sm text-muted-foreground">No members yet.</p>
              )}
              {!loadingMembers && members.length > 0 && (
                <>
                  <p className="text-sm text-muted-foreground mb-3">
                    {members.length} member{members.length !== 1 ? 's' : ''}
                  </p>
                  <ul className="space-y-2">
                    {members.slice(0, 5).map((member) => (
                      <li
                        key={member.userId}
                        className="flex items-center justify-between py-1"
                      >
                        <div>
                          <p className="text-sm font-medium">{member.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {member.email}
                          </p>
                        </div>
                        <span className="text-xs px-2 py-1 bg-muted rounded">
                          {member.role}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {members.length > 5 && (
                    <Link
                      to="/w/$workspaceSlug/settings"
                      params={{ workspaceSlug: workspace.slug }}
                      className="inline-block mt-3 text-sm text-primary hover:underline"
                    >
                      View all members →
                    </Link>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <CreateProjectModal
        workspaceSlug={workspace.slug}
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreated={(project) => {
          setProjects((prev) =>
            prev.some((p) => p.id === project.id)
              ? prev
              : [...prev, { ...project, role: 'owner' }],
          );
          navigate({ to: '/p/$projectSlug', params: { projectSlug: project.slug } });
        }}
      />
    </div>
  );
}