import { readFile } from 'node:fs/promises';
import { artifactPathFor, writeArtifact } from './artifact-store.js';
import { appendProjectEvent } from './events.js';
import { resolveProjectWorkspace } from './workspace.js';

export async function scaffoldExecutionSeedAssetsFromStoryboard(
  projectSlug: string,
  root = process.cwd(),
): Promise<{
  artifactPath: string;
  artifact: {
    projectSlug: string;
    assets: Array<{
      id: string;
      kind: 'other';
      path: string;
      sceneIndex: number;
      backend: 'storyboard-seed';
    }>;
  };
}> {
  const workspace = resolveProjectWorkspace(projectSlug, root);
  const storyboard = JSON.parse(await readFile(artifactPathFor(workspace, 'storyboard'), 'utf-8')) as {
    scenes?: Array<{ sceneIndex?: number }>;
  };
  const artifact = {
    projectSlug,
    assets: (storyboard.scenes ?? []).map((scene, index) => ({
      id: `scene-${scene.sceneIndex ?? index}-seed`,
      kind: 'other' as const,
      path: `storyboard://scene/${scene.sceneIndex ?? index}`,
      sceneIndex: scene.sceneIndex ?? index,
      backend: 'storyboard-seed' as const,
    })),
  };
  const artifactPath = await writeArtifact(workspace, 'asset-manifest', artifact);
  await appendProjectEvent(workspace, {
    type: 'artifact.asset-manifest.written',
    payload: {
      artifactPath,
      assetCount: artifact.assets.length,
      source: 'storyboard-seed',
    },
  });
  return { artifactPath, artifact };
}
