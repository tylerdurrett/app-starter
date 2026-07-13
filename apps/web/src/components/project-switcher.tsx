import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings } from 'lucide-react';
import { canWorkspace, type WorkspaceRole } from '../lib/permissions';
import { workspaceProjectsQueryOptions } from '../lib/workspace-queries';
import { CreateProjectModal } from './create-project-modal';
import {
  Selector,
  SelectorDivider,
  SelectorRowContent,
  SelectorSectionLabel,
  selectorRowClass,
} from './selector';

interface ProjectSwitcherProps {
  workspaceSlug: string;
  workspaceRole: WorkspaceRole;
  activeProjectSlug: string | null;
}

export function ProjectSwitcher({
  workspaceSlug,
  workspaceRole,
  activeProjectSlug,
}: ProjectSwitcherProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const projectsQueryOptions = workspaceProjectsQueryOptions(workspaceSlug);
  const projectsQuery = useQuery(projectsQueryOptions);
  const projects = projectsQuery.data ?? [];

  const canCreate = canWorkspace(workspaceRole, 'projects:create');

  const activeProject = projects.find((p) => p.slug === activeProjectSlug);
  const triggerAvatar = activeProject?.name[0]?.toUpperCase() ?? 'P';

  return (
    <>
      <Selector
        ariaLabel="Switch project"
        openDirection="down"
        trigger={{
          title: activeProject?.name ?? 'Projects',
          avatarLabel: triggerAvatar,
          muted: !activeProject,
        }}
        onOpen={() => {
          void projectsQuery.refetch();
        }}
      >
        {({ close }) => (
          <>
            <SelectorSectionLabel>Projects</SelectorSectionLabel>

            {projectsQuery.isPending && (
              <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                Loading...
              </div>
            )}

            {projectsQuery.isError && (
              <div className="px-2 py-3 text-sm text-destructive text-center">
                Failed to load projects
              </div>
            )}

            {!projectsQuery.isPending && !projectsQuery.isError && (
              <ul className="space-y-0.5">
                {projects.map((project) => {
                  const isActive = project.slug === activeProjectSlug;
                  return (
                    <li key={project.id}>
                      <Link
                        to="/w/$workspaceSlug/p/$projectSlug"
                        params={{ workspaceSlug, projectSlug: project.slug }}
                        onClick={close}
                        className={selectorRowClass(isActive)}
                      >
                        <SelectorRowContent name={project.name} isActive={isActive} />
                      </Link>
                    </li>
                  );
                })}
                {projects.length === 0 && (
                  <li className="px-2 py-1.5 text-sm text-muted-foreground">
                    No projects yet
                  </li>
                )}
              </ul>
            )}

            {canCreate && (
              <>
                <SelectorDivider />
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setShowCreateModal(true);
                  }}
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-sm w-full text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  New project
                </button>
              </>
            )}

            {activeProject && (
              <>
                <SelectorDivider />
                <Link
                  to="/w/$workspaceSlug/p/$projectSlug/settings"
                  params={{ workspaceSlug, projectSlug: activeProject.slug }}
                  onClick={close}
                  className="flex items-center gap-2 px-2 py-1.5 rounded text-sm w-full text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  Project settings
                </Link>
              </>
            )}
          </>
        )}
      </Selector>

      <CreateProjectModal
        workspaceSlug={workspaceSlug}
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreated={(project) => {
          void queryClient.invalidateQueries({ queryKey: projectsQueryOptions.queryKey });
          navigate({
            to: '/w/$workspaceSlug/p/$projectSlug',
            params: { workspaceSlug, projectSlug: project.slug },
          });
        }}
      />
    </>
  );
}
