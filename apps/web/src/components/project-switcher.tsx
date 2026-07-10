import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus, Settings } from 'lucide-react';
import { listProjectsForWorkspace } from '../lib/workspaces';
import { type ProjectWithRole } from '../lib/projects';
import { canWorkspace, type WorkspaceRole } from '../lib/permissions';
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
  const [projects, setProjects] = useState<ProjectWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const fetchIdRef = useRef(0);

  const canCreate = canWorkspace(workspaceRole, 'projects:create');

  const fetchProjects = useCallback(() => {
    const id = ++fetchIdRef.current;
    setLoading(true);
    setFetchError('');
    listProjectsForWorkspace(workspaceSlug)
      .then((data) => {
        if (fetchIdRef.current === id) setProjects(data);
      })
      .catch(() => {
        if (fetchIdRef.current === id) setFetchError('Failed to load projects');
      })
      .finally(() => {
        if (fetchIdRef.current === id) setLoading(false);
      });
  }, [workspaceSlug]);

  // Fetch on mount so the trigger reflects the active project before the popover opens
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

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
        onOpen={fetchProjects}
      >
        {({ close }) => (
          <>
            <SelectorSectionLabel>Projects</SelectorSectionLabel>

            {loading && (
              <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                Loading...
              </div>
            )}

            {fetchError && (
              <div className="px-2 py-3 text-sm text-destructive text-center">
                {fetchError}
              </div>
            )}

            {!loading && !fetchError && (
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
          setProjects((prev) =>
            prev.some((p) => p.id === project.id)
              ? prev
              : [...prev, { ...project, role: 'owner' }],
          );
          navigate({
            to: '/w/$workspaceSlug/p/$projectSlug',
            params: { workspaceSlug, projectSlug: project.slug },
          });
        }}
      />
    </>
  );
}
