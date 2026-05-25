import { buildProjectIndex } from './project-index.js';
import type { VideoProductionMode } from './types.js';

export interface OwnerWorkloadEntry {
  owner: string;
  totalProjects: number;
  activeProjects: number;
  blockedProjects: number;
  needsReviewProjects: number;
  dueSoonProjects: number;
  overdueProjects: number;
  averageScore: number;
  byPlatform: Record<string, number>;
  projects: string[];
}

export interface OwnerWorkloadReport {
  generatedAt: string;
  root: string;
  owners: OwnerWorkloadEntry[];
}

export async function buildOwnerWorkloadReport(
  root = process.cwd(),
  productionMode: VideoProductionMode = 'storyboard',
): Promise<OwnerWorkloadReport> {
  const index = await buildProjectIndex(root, productionMode);
  const buckets = new Map<string, {
    totalProjects: number;
    activeProjects: number;
    blockedProjects: number;
    needsReviewProjects: number;
    dueSoonProjects: number;
    overdueProjects: number;
    totalScore: number;
    byPlatform: Record<string, number>;
    projects: string[];
  }>();

  for (const project of index.projects) {
    const owner = project.owner ?? 'unassigned';
    const bucket = buckets.get(owner) ?? {
      totalProjects: 0,
      activeProjects: 0,
        blockedProjects: 0,
        needsReviewProjects: 0,
        dueSoonProjects: 0,
        overdueProjects: 0,
        totalScore: 0,
        byPlatform: {},
        projects: [],
      };

    bucket.totalProjects += 1;
    if (project.opsStatus === 'active') bucket.activeProjects += 1;
    if (project.opsStatus === 'blocked') bucket.blockedProjects += 1;
    if (project.opsStatus === 'needs-review') bucket.needsReviewProjects += 1;
    if (project.dueRisk === 'soon') bucket.dueSoonProjects += 1;
    if (project.dueRisk === 'overdue') bucket.overdueProjects += 1;
    bucket.totalScore += project.score;
    const platformKey = project.platform ?? 'unset';
    bucket.byPlatform[platformKey] = (bucket.byPlatform[platformKey] ?? 0) + 1;
    bucket.projects.push(project.slug);
    buckets.set(owner, bucket);
  }

  const owners: OwnerWorkloadEntry[] = [...buckets.entries()]
    .map(([owner, bucket]) => ({
      owner,
      totalProjects: bucket.totalProjects,
      activeProjects: bucket.activeProjects,
      blockedProjects: bucket.blockedProjects,
      needsReviewProjects: bucket.needsReviewProjects,
      dueSoonProjects: bucket.dueSoonProjects,
      overdueProjects: bucket.overdueProjects,
      averageScore: bucket.totalProjects === 0 ? 0 : bucket.totalScore / bucket.totalProjects,
      byPlatform: bucket.byPlatform,
      projects: bucket.projects.sort(),
    }))
    .sort((left, right) => right.totalProjects - left.totalProjects || left.owner.localeCompare(right.owner));

  return {
    generatedAt: new Date().toISOString(),
    root,
    owners,
  };
}
