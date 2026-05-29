import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeTextFileAtomic } from '../atomic-write.js';
import { resolveProjectWorkspace } from '../workspace.js';
import type { StudioPlan } from './types.js';

export interface StudioSessionArtifact {
  schemaVersion: 1;
  createdAt: string;
  plan: StudioPlan;
}

export async function writeStudioSession(root: string, project: string, plan: StudioPlan): Promise<string> {
  const workspace = resolveProjectWorkspace(project, root);
  await mkdir(workspace.artifactsDir, { recursive: true });
  const path = join(workspace.artifactsDir, 'studio-session.json');
  const artifact: StudioSessionArtifact = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    plan,
  };
  await writeTextFileAtomic(path, `${JSON.stringify(artifact, null, 2)}\n`);
  return path;
}
