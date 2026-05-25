import { buildProjectIndex } from './project-index.js';
import type { VideoProductionMode } from './types.js';
import type { LegacyImportSummary } from './types.js';

export interface ProjectDependencyEdge {
  from: string;
  to: string;
  reason?: string | null;
}

export interface ProjectDependencyReport {
  generatedAt: string;
  root: string;
  nodes: Array<{
    slug: string;
    opsStatus: string;
    legacyImportSummary?: LegacyImportSummary;
    platform?: string;
    blockedBy: string[];
  }>;
  edges: ProjectDependencyEdge[];
  blockedProjects: string[];
  blockerProjects: string[];
}

export async function buildDependencyReport(
  root = process.cwd(),
  productionMode: VideoProductionMode = 'storyboard',
): Promise<ProjectDependencyReport> {
  const index = await buildProjectIndex(root, productionMode);
  const edges: ProjectDependencyEdge[] = [];
  const blockerProjects = new Set<string>();
  const blockedProjects: string[] = [];

  for (const project of index.projects) {
    const blockers = project.blockedBy ?? [];
    if (blockers.length > 0) {
      blockedProjects.push(project.slug);
    }
    for (const blocker of blockers) {
      blockerProjects.add(blocker);
      edges.push({
        from: project.slug,
        to: blocker,
        reason: project.blockedReason ?? null,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    root,
    nodes: index.projects.map((project) => ({
      slug: project.slug,
      opsStatus: project.opsStatus,
      ...(project.legacyImportSummary ? { legacyImportSummary: project.legacyImportSummary } : {}),
      ...(project.platform ? { platform: project.platform } : {}),
      blockedBy: project.blockedBy ?? [],
    })),
    edges,
    blockedProjects: blockedProjects.sort(),
    blockerProjects: [...blockerProjects].sort(),
  };
}
