import type { BetterAuthOptions } from 'better-auth';
import { createWorkspace } from '../workspaces/service.js';
import { createProject } from '../projects/service.js';

/**
 * Better Auth databaseHooks -- creates a personal workspace and default project for every new user.
 *
 * Why: Every user needs at least one workspace and project. Creating them in the signup
 * lifecycle avoids a separate onboarding step for the common case.
 *
 * Atomicity is not required, but silent partial success is not acceptable
 * -- errors are logged loudly.
 */
export const postSignupHooks: BetterAuthOptions['databaseHooks'] = {
  user: {
    create: {
      after: async (user) => {
        const workspaceName = (user.name as string | null)?.trim();
        const displayName = workspaceName ? `${workspaceName.split(' ')[0]}'s Workspace` : 'Personal';

        try {
          // Create personal workspace
          const workspace = await createWorkspace({ name: displayName, ownerUserId: user.id as string });

          // Create default project inside the workspace
          try {
            await createProject({
              name: 'Personal',
              workspaceId: workspace.id,
              ownerUserId: user.id as string,
            });
          } catch (projectErr) {
            // Log project creation failure separately
            console.error(
              `[post-signup] Failed to create default project for user ${user.id} (${user.email}) in workspace ${workspace.id}:`,
              projectErr,
            );
          }
        } catch (err) {
          // Log workspace creation failure (project won't be created if this fails)
          console.error(
            `[post-signup] Failed to create personal workspace for user ${user.id} (${user.email}):`,
            err,
          );
        }
      },
    },
  },
};
