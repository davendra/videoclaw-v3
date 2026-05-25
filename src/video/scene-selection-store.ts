import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { resolveProjectWorkspace } from './workspace.js';
import { writeTextFileAtomic } from './atomic-write.js';
import type { SceneSelectionArtifact } from './types.js';

export function sceneSelectionPathFor(root: string, slug: string): string {
  return join(
    resolveProjectWorkspace(slug, root).projectDir,
    'artifacts',
    'scene-selection.json',
  );
}

export async function readSceneSelectionArtifact(
  root: string,
  slug: string,
): Promise<SceneSelectionArtifact> {
  const path = sceneSelectionPathFor(root, slug);
  if (!existsSync(path)) {
    return { schemaVersion: 1, scenes: [] };
  }
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as SceneSelectionArtifact;
}

export async function writeSceneSelectionArtifact(
  root: string,
  slug: string,
  artifact: SceneSelectionArtifact,
): Promise<void> {
  const path = sceneSelectionPathFor(root, slug);
  await mkdir(dirname(path), { recursive: true });
  await writeTextFileAtomic(path, JSON.stringify(artifact, null, 2) + '\n');
}
