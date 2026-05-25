import { doctorProject } from './doctor.js';
import { listProjects } from './projects.js';
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import { findRoleCollisions, sheetsCoveringScene } from './reference-sheets.js';
import { artifactPathFor } from './artifact-store.js';
import { readStageCheckpoint } from './checkpoints.js';
import { readSceneCandidatesArtifact, sceneCandidatesPathFor } from './scene-candidate-store.js';
import { readProjectManifest, resolveProjectWorkspace } from './workspace.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { buildProjectStatusReport } from './status.js';
import type { VideoProductionMode } from './types.js';

export interface VideoPortfolioDoctorEntry {
  slug: string;
  ok: boolean;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  issues: Array<{
    severity: 'error' | 'warning';
    message: string;
  }>;
}

export interface VideoPortfolioReferenceSheetsSummary {
  projectsWithSheets: number;
  projectsWithCollisions: number;
  projectsWithUnassignedRoles: number;
  projectsWithoutIdentityWhenApprovalPending: number;
}

export interface VideoPortfolioSceneCandidatesSummary {
  projectsWithCandidates: number;
  projectsWithMissingSelection: number;
  projectsWithStaleSelection: number;
  projectsWithPendingReroll: number;
  projectsWithStaleChainUpstream: number;
}

export interface VideoPortfolioDoctorReport {
  generatedAt: string;
  root: string;
  totalProjects: number;
  healthyProjects: number;
  unhealthyProjects: number;
  warningProjects: number;
  legacyImportedProjects: number;
  legacyQueueDriftProjects: number;
  legacyNestedOutputProjects: number;
  missingStoryboardReviewProjects: number;
  staleStoryboardReviewProjects: number;
  referenceSheets: VideoPortfolioReferenceSheetsSummary;
  sceneCandidates: VideoPortfolioSceneCandidatesSummary;
  entries: VideoPortfolioDoctorEntry[];
}

export async function doctorPortfolio(
  root = process.cwd(),
  productionMode: VideoProductionMode = 'storyboard',
): Promise<VideoPortfolioDoctorReport> {
  const slugs = await listProjects(root);
  const entries: VideoPortfolioDoctorEntry[] = [];
  let legacyImportedProjects = 0;
  let legacyQueueDriftProjects = 0;
  let legacyNestedOutputProjects = 0;
  let projectsWithSheets = 0;
  let projectsWithCollisions = 0;
  let projectsWithUnassignedRoles = 0;
  let projectsWithoutIdentityWhenApprovalPending = 0;
  let projectsWithCandidates = 0;
  let projectsWithMissingSelection = 0;
  let projectsWithStaleSelection = 0;
  let projectsWithPendingReroll = 0;
  let projectsWithStaleChainUpstream = 0;

  for (const slug of slugs) {
    const report = await doctorProject(slug, root, productionMode);
    const status = await buildProjectStatusReport(slug, root, productionMode);
    if (status.legacyImportSummary) {
      legacyImportedProjects += 1;
      if (status.legacyImportSummary.queueStatusMismatch) {
        legacyQueueDriftProjects += 1;
      }
      if (status.legacyImportSummary.nestedOutputRootDetected) {
        legacyNestedOutputProjects += 1;
      }
    }

    const workspace = resolveProjectWorkspace(slug, root);
    const projectManifest = await readProjectManifest(workspace);
    const resolvedMode = projectManifest?.productionMode ?? productionMode;
    const sheetsArtifact = await readReferenceSheetsArtifact(workspace.root, slug);
    if (sheetsArtifact.sheets.length > 0) {
      projectsWithSheets += 1;
    }
    if (findRoleCollisions(sheetsArtifact).length > 0) {
      projectsWithCollisions += 1;
    }
    const hasUnassignedRole = sheetsArtifact.sheets.some((sheet) =>
      sheet.references.some((ref) => !ref.role),
    );
    if (hasUnassignedRole) {
      projectsWithUnassignedRoles += 1;
    }

    if (resolvedMode === 'director') {
      const storyboardCheckpoint = await readStageCheckpoint(workspace, 'storyboard');
      if (storyboardCheckpoint?.status === 'awaiting-approval') {
        const storyboardPath = artifactPathFor(workspace, 'storyboard');
        if (existsSync(storyboardPath)) {
          try {
            const storyboard = JSON.parse(await readFile(storyboardPath, 'utf-8')) as {
              scenes?: Array<{ sceneIndex?: number; characters?: string[] }>;
            };
            let missingIdentity = false;
            for (const [i, scene] of (storyboard.scenes ?? []).entries()) {
              if (!scene.characters || scene.characters.length === 0) continue;
              const sceneIndex = typeof scene.sceneIndex === 'number' ? scene.sceneIndex : i;
              const covering = sheetsCoveringScene(sheetsArtifact, sceneIndex);
              if (!covering.some((sheet) => sheet.type === 'identity')) {
                missingIdentity = true;
                break;
              }
            }
            if (missingIdentity) {
              projectsWithoutIdentityWhenApprovalPending += 1;
            }
          } catch {
            // Storyboard unreadable — other checks surface it.
          }
        }
      }
    }

    // Scene-candidate aggregation (feature-gated on candidates file presence).
    if (existsSync(sceneCandidatesPathFor(workspace.root, slug))) {
      const sceneCandidates = await readSceneCandidatesArtifact(workspace.root, slug);
      if (sceneCandidates.scenes.some((entry) => entry.candidates.length > 0)) {
        projectsWithCandidates += 1;
      }
      if (report.issues.some((issue) => issue.message.startsWith('scene-selection-missing:'))) {
        projectsWithMissingSelection += 1;
      }
      if (report.issues.some((issue) => issue.message.startsWith('scene-selection-stale:'))) {
        projectsWithStaleSelection += 1;
      }
      if (report.issues.some((issue) => issue.message.startsWith('scene-reroll-pending:'))) {
        projectsWithPendingReroll += 1;
      }
      if (report.issues.some((issue) => issue.message.startsWith('scene-chain-upstream-stale:'))) {
        projectsWithStaleChainUpstream += 1;
      }
    }

    entries.push({
      slug,
      ok: report.ok,
      issueCount: report.issues.length,
      errorCount: report.issues.filter((issue) => issue.severity === 'error').length,
      warningCount: report.issues.filter((issue) => issue.severity === 'warning').length,
      issues: report.issues,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    root,
    totalProjects: entries.length,
    healthyProjects: entries.filter((entry) => entry.ok).length,
    unhealthyProjects: entries.filter((entry) => !entry.ok).length,
    warningProjects: entries.filter((entry) => entry.ok && entry.warningCount > 0).length,
    legacyImportedProjects,
    legacyQueueDriftProjects,
    legacyNestedOutputProjects,
    missingStoryboardReviewProjects: entries.filter((entry) =>
      entry.issues.some((issue) => issue.message.includes('storyboard.md is missing')),
    ).length,
    staleStoryboardReviewProjects: entries.filter((entry) =>
      entry.issues.some((issue) => issue.message.includes('storyboard.md is stale')),
    ).length,
    referenceSheets: {
      projectsWithSheets,
      projectsWithCollisions,
      projectsWithUnassignedRoles,
      projectsWithoutIdentityWhenApprovalPending,
    },
    sceneCandidates: {
      projectsWithCandidates,
      projectsWithMissingSelection,
      projectsWithStaleSelection,
      projectsWithPendingReroll,
      projectsWithStaleChainUpstream,
    },
    entries,
  };
}
