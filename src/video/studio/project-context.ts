import { existsSync } from 'node:fs';
import { buildNextActions } from '../next-actions.js';
import { buildProjectReadiness } from '../readiness.js';
import type { VideoProductionMode } from '../types.js';
import { resolveProjectWorkspace } from '../workspace.js';
import type { StudioProjectContext } from './types.js';

export async function loadStudioProjectContext(
  root: string,
  project: string | undefined,
  mode: VideoProductionMode = 'storyboard',
): Promise<StudioProjectContext> {
  if (!project) return { projectExists: false };
  const workspace = resolveProjectWorkspace(project, root);
  if (!existsSync(workspace.projectDir)) return { projectExists: false };

  const readiness = await buildProjectReadiness(project, root, mode);
  const nextActions = await buildNextActions(root, mode);
  return {
    projectExists: true,
    readinessReady: readiness.ready,
    readinessNextAction: readiness.nextAction,
    nextActionCount: nextActions.actions.length,
  };
}
