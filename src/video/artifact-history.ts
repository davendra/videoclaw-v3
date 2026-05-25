import { listArtifactHistory } from './artifact-store.js';
import { resolveProjectWorkspace } from './workspace.js';
import type { VideoStageArtifactName } from './types.js';

export interface ArtifactHistoryReport {
  slug: string;
  artifact: VideoStageArtifactName;
  historyFiles: string[];
}

export async function buildArtifactHistoryReport(
  slug: string,
  artifact: VideoStageArtifactName,
  root = process.cwd(),
): Promise<ArtifactHistoryReport> {
  const workspace = resolveProjectWorkspace(slug, root);
  const historyFiles = await listArtifactHistory(workspace, artifact);
  return {
    slug,
    artifact,
    historyFiles,
  };
}
