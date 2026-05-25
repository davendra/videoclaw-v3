import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactPathFor } from './artifact-store.js';
import { buildCharacterConsistencyReport } from './character-consistency.js';
import {
  validateAnalyzeOutputArtifact,
  validateAssetManifestArtifact,
  validateBriefArtifact,
  validateClonePlanArtifact,
  validateExecutionPlanArtifact,
  validateExecutionReportArtifact,
  validatePublishReportArtifact,
  validateReviewReportArtifact,
  validateStoryboardArtifact,
} from './artifact-validation.js';
import { getBuiltinPipelineManifest } from './pipeline-manifest.js';
import { readStageCheckpoint } from './checkpoints.js';
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import { findRoleCollisions, sheetsCoveringScene } from './reference-sheets.js';
import { readSceneCandidatesArtifact, sceneCandidatesPathFor } from './scene-candidate-store.js';
import { readSceneSelectionArtifact } from './scene-selection-store.js';
import { readProjectEvents } from './events.js';
import { buildProjectStatusReport } from './status.js';
import { readProjectManifest, resolveProjectWorkspace } from './workspace.js';
import type { VideoProductionMode, VideoStageArtifactName } from './types.js';

export interface VideoProjectDoctorIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface VideoProjectDoctorReport {
  slug: string;
  root: string;
  ok: boolean;
  issues: VideoProjectDoctorIssue[];
}

function formatJsonParseError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'unknown JSON parse error';
}

function validateArtifactByName(name: VideoStageArtifactName, value: unknown): VideoProjectDoctorIssue[] {
  switch (name) {
    case 'brief':
      return validateBriefArtifact(value);
    case 'clone-plan':
      return validateClonePlanArtifact(value);
    case 'execution-plan':
      return validateExecutionPlanArtifact(value);
    case 'execution-report':
      return validateExecutionReportArtifact(value);
    case 'storyboard':
      return validateStoryboardArtifact(value);
    case 'asset-manifest':
      return validateAssetManifestArtifact(value);
    case 'review-report':
      return validateReviewReportArtifact(value);
    case 'publish-report':
      return validatePublishReportArtifact(value);
    case 'analyze-output':
      return validateAnalyzeOutputArtifact(value);
  }
  return [];
}

export async function doctorProject(
  slug: string,
  root = process.cwd(),
  productionMode: VideoProductionMode = 'storyboard',
): Promise<VideoProjectDoctorReport> {
  const workspace = resolveProjectWorkspace(slug, root);
  const issues: VideoProjectDoctorIssue[] = [];
  const storyboardReviewPath = join(workspace.projectDir, 'storyboard.md');

  if (!existsSync(workspace.projectDir)) {
    issues.push({ severity: 'error', message: 'Project directory does not exist.' });
    return { slug, root: workspace.root, ok: false, issues };
  }

  if (!existsSync(workspace.manifestPath)) {
    issues.push({ severity: 'error', message: 'Missing project manifest.' });
  }
  const projectManifest = await readProjectManifest(workspace);
  const manifest = getBuiltinPipelineManifest(projectManifest?.productionMode ?? productionMode);
  const status = await buildProjectStatusReport(slug, root, productionMode);

  for (const stage of manifest.stages) {
    const checkpoint = await readStageCheckpoint(workspace, stage.name);
    if (!checkpoint) continue;

    if (checkpoint.status === 'failed') {
      issues.push({
        severity: 'error',
        message: checkpoint.issues[0] ?? checkpoint.summary ?? `Stage "${stage.name}" failed.`,
      });
    }

    if (stage.name === 'storyboard' && checkpoint.status === 'awaiting-approval' && !existsSync(storyboardReviewPath)) {
      issues.push({
        severity: 'error',
        message: 'Storyboard approval is pending but storyboard.md is missing.',
      });
    }
    if (stage.name === 'storyboard' && checkpoint.status === 'awaiting-approval' && status.storyboardReviewStale) {
      issues.push({
        severity: 'error',
        message: 'Storyboard approval is pending but storyboard.md is stale relative to the latest storyboard changes.',
      });
    }

    if (checkpoint.status === 'completed') {
      for (const artifactName of stage.produces) {
        const artifactPath = checkpoint.artifacts[artifactName];
        if (!artifactPath) {
          issues.push({
            severity: 'error',
            message: `Completed stage "${stage.name}" is missing artifact pointer for "${artifactName}".`,
          });
          continue;
        }
        if (!existsSync(artifactPath)) {
          issues.push({
            severity: 'error',
            message: `Completed stage "${stage.name}" points to missing artifact file: ${artifactPath}`,
          });
          continue;
        }
        let artifactValue: unknown;
        try {
          artifactValue = JSON.parse(await readFile(artifactPath, 'utf-8')) as unknown;
        } catch (error) {
          issues.push({
            severity: 'error',
            message: `${artifactName}: malformed JSON artifact (${formatJsonParseError(error)})`,
          });
          continue;
        }
        const validationIssues = validateArtifactByName(artifactName, artifactValue);
        for (const issue of validationIssues) {
          issues.push({
            severity: issue.severity,
            message: `${artifactName}: ${issue.message}`,
          });
        }
      }
    }

    if (stage.name === 'publish' && checkpoint.status === 'completed') {
      const publishPath = checkpoint.artifacts['publish-report'];
      if (publishPath && existsSync(publishPath)) {
        let publishArtifact: { status?: string } | null = null;
        try {
          publishArtifact = JSON.parse(await readFile(publishPath, 'utf-8')) as { status?: string };
        } catch (error) {
          issues.push({
            severity: 'error',
            message: `publish-report: malformed JSON artifact (${formatJsonParseError(error)})`,
          });
          publishArtifact = null;
        }
        if (!publishArtifact) continue;
        if (publishArtifact.status === 'blocked') {
          issues.push({
            severity: 'error',
            message: 'Publish checkpoint is completed but publish artifact is blocked.',
          });
        }
      }
    }
  }

  const reviewCheckpoint = status.checkpoints.find((checkpoint) => checkpoint.stage === 'review');
  if (reviewCheckpoint && reviewCheckpoint.status !== 'completed') {
    issues.push({
      severity: 'error',
      message: `Review checkpoint is ${reviewCheckpoint.status}: ${reviewCheckpoint.nextAction ?? 'Resolve review findings before publishing.'}`,
    });
  }

  const storyboardCheckpoint = status.checkpoints.find((checkpoint) => checkpoint.stage === 'storyboard');
  if (status.storyboardReviewStale && storyboardCheckpoint?.status !== 'awaiting-approval') {
    issues.push({
      severity: 'error',
      message: 'Storyboard review is stale relative to the latest storyboard changes.',
    });
  }

  const reviewReportPath = artifactPathFor(workspace, 'review-report');
  if (existsSync(reviewReportPath)) {
    try {
      const reviewReport = JSON.parse(await readFile(reviewReportPath, 'utf-8')) as unknown;
      const reviewIssue = reviewReadinessIssue(reviewReport);
      if (reviewIssue) {
        issues.push({
          severity: 'error',
          message: reviewIssue,
        });
      }
    } catch (error) {
      if (reviewCheckpoint?.status !== 'completed') {
        issues.push({
          severity: 'error',
          message: `review-report: malformed JSON artifact (${formatJsonParseError(error)})`,
        });
      }
    }
  }

  const canonicalArtifacts: VideoStageArtifactName[] = ['brief', 'clone-plan', 'execution-plan', 'execution-report', 'storyboard', 'asset-manifest', 'review-report', 'publish-report', 'analyze-output'];
  for (const artifactName of canonicalArtifacts) {
    const path = artifactPathFor(workspace, artifactName);
    if (existsSync(path) && !path.startsWith(workspace.artifactsDir)) {
      issues.push({
        severity: 'warning',
        message: `Artifact path for ${artifactName} resolves outside the artifacts directory.`,
      });
    }
  }

  const characterConsistency = await buildCharacterConsistencyReport(slug, root);
  for (const message of characterConsistency.issues) {
    issues.push({
      severity: 'error',
      message,
    });
  }

  if (status.legacyImportSummary?.queueStatusMismatch) {
    issues.push({
      severity: 'warning',
      message: 'Legacy import detected queue/output drift; reconcile queue state against discovered outputs.',
    });
  }
  if (status.legacyImportSummary?.nestedOutputRootDetected) {
    issues.push({
      severity: 'warning',
      message: 'Legacy import detected nested output roots inside the project folder.',
    });
  }

  // Reference-sheet diagnostics
  const referenceSheetsArtifact = await readReferenceSheetsArtifact(workspace.root, slug);
  for (const sheet of referenceSheetsArtifact.sheets) {
    for (const [i, ref] of sheet.references.entries()) {
      if (!ref.role) {
        issues.push({
          severity: 'error',
          message: `reference-sheet-unassigned-role: sheet=${sheet.id} ref-index=${i}`,
        });
      }
    }
  }
  const collisions = findRoleCollisions(referenceSheetsArtifact);
  for (const collision of collisions) {
    issues.push({
      severity: 'error',
      message: `reference-sheet-role-collision: scene ${collision.sceneIndex} role="${collision.role}" sheets=${collision.sheetIds.join(',')}`,
    });
  }

  // reference-sheet-missing-identity-when-approval-pending (director-mode only)
  const resolvedMode = projectManifest?.productionMode ?? productionMode;
  if (resolvedMode === 'director') {
    const storyboardCheckpoint = await readStageCheckpoint(workspace, 'storyboard');
    if (storyboardCheckpoint?.status === 'awaiting-approval') {
      const storyboardPath = artifactPathFor(workspace, 'storyboard');
      if (existsSync(storyboardPath)) {
        try {
          const storyboard = JSON.parse(await readFile(storyboardPath, 'utf-8')) as {
            scenes?: Array<{ sceneIndex?: number; characters?: string[] }>;
          };
          for (const [i, scene] of (storyboard.scenes ?? []).entries()) {
            if (!scene.characters || scene.characters.length === 0) continue;
            const sceneIndex = typeof scene.sceneIndex === 'number' ? scene.sceneIndex : i;
            const covering = sheetsCoveringScene(referenceSheetsArtifact, sceneIndex);
            const hasIdentity = covering.some((sheet) => sheet.type === 'identity');
            if (!hasIdentity) {
              issues.push({
                severity: 'error',
                message: `reference-sheet-missing-identity-when-approval-pending: scene ${sceneIndex} has character bindings but no Identity Sheet is bound to it`,
              });
            }
          }
        } catch {
          // Storyboard unreadable — other checks surface it.
        }
      }
    }
  }

  // Scene-candidate diagnostics (feature-gated on the presence of
  // scene-candidates.json on disk; legacy projects with no candidates skip
  // this block entirely).
  if (existsSync(sceneCandidatesPathFor(workspace.root, slug))) {
    const sceneCandidates = await readSceneCandidatesArtifact(workspace.root, slug);
    const sceneSelection = await readSceneSelectionArtifact(workspace.root, slug);
    const projectEvents = await readProjectEvents(workspace);

    const selectionByScene = new Map<number, typeof sceneSelection.scenes[number]>();
    for (const entry of sceneSelection.scenes) {
      selectionByScene.set(entry.sceneIndex, entry);
    }
    const candidatesById = new Map<string, { sceneIndex: number; candidate: typeof sceneCandidates.scenes[number]['candidates'][number] }>();
    for (const entry of sceneCandidates.scenes) {
      for (const candidate of entry.candidates) {
        candidatesById.set(candidate.id, { sceneIndex: entry.sceneIndex, candidate });
      }
    }

    for (const entry of sceneCandidates.scenes) {
      if (entry.candidates.length === 0) continue;
      const selection = selectionByScene.get(entry.sceneIndex);
      const selectedId = selection?.selectedCandidateId ?? null;

      // scene-selection-missing: has ≥1 candidate but no selection.
      if (!selectedId) {
        issues.push({
          severity: 'error',
          message: `scene-selection-missing: scene ${entry.sceneIndex} has candidates but no selection`,
        });
      } else {
        // scene-selection-stale: selected candidate's output file no longer
        // exists on disk.
        const selectedCandidate = entry.candidates.find((c) => c.id === selectedId);
        if (selectedCandidate) {
          for (const output of selectedCandidate.outputs) {
            if (!isRemoteArtifactPath(output.path) && !existsSync(output.path)) {
              issues.push({
                severity: 'error',
                message: `scene-selection-stale: scene ${entry.sceneIndex} selected ${selectedId} but output file is missing: ${output.path}`,
              });
            }
          }
        }

        // scene-chain-upstream-stale: selected candidate references a source
        // candidate via chainedFromCandidateId, but that source was either
        // rejected OR its scene has an active reroll request.
        const upstreamId = selectedCandidate?.source.chainedFromCandidateId ?? null;
        if (upstreamId) {
          const upstream = candidatesById.get(upstreamId);
          if (upstream) {
            const upstreamSelection = selectionByScene.get(upstream.sceneIndex);
            const rejected = upstreamSelection?.rejectedCandidateIds.includes(upstreamId) ?? false;
            const upstreamRerolled = upstreamSelection?.rerollRequested ?? false;
            if (rejected || upstreamRerolled) {
              issues.push({
                severity: 'error',
                message: `scene-chain-upstream-stale: scene ${entry.sceneIndex} chains from ${upstreamId} (scene ${upstream.sceneIndex}) but upstream is ${rejected ? 'rejected' : 'rerolled'}`,
              });
            }
          }
        }
      }
    }

    // scene-reroll-pending: rerollRequested is true but no new candidate has
    // been added since the reroll was requested. Use events to compare the
    // latest reroll timestamp to the latest candidate submittedAt.
    for (const selectionEntry of sceneSelection.scenes) {
      if (!selectionEntry.rerollRequested) continue;
      const rerollEvents = projectEvents
        .filter((ev) =>
          ev.type === 'scene-reroll.requested'
          && (ev.payload as { sceneIndex?: number } | undefined)?.sceneIndex === selectionEntry.sceneIndex,
        )
        .map((ev) => ev.recordedAt)
        .sort();
      const latestReroll = rerollEvents[rerollEvents.length - 1];
      const candidateEntry = sceneCandidates.scenes.find((s) => s.sceneIndex === selectionEntry.sceneIndex);
      const latestSubmittedAt = candidateEntry
        ? candidateEntry.candidates
            .map((c) => c.submittedAt)
            .sort()
            .slice(-1)[0]
        : undefined;
      // When no reroll event was recorded, fall back to the simpler signal:
      // rerollRequested is still set, so treat it as pending.
      const pending = latestReroll
        ? !latestSubmittedAt || latestSubmittedAt <= latestReroll
        : true;
      if (pending) {
        issues.push({
          severity: 'warning',
          message: `scene-reroll-pending: scene ${selectionEntry.sceneIndex} has rerollRequested=true but no new candidate has been added since the request`,
        });
      }
    }
  }

  return {
    slug,
    root: workspace.root,
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}

function isRemoteArtifactPath(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

function reviewReadinessIssue(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const verdict = typeof value.verdict === 'string' ? value.verdict : undefined;
  const metrics = isRecord(value.metrics) ? value.metrics : {};
  const publishReady = metrics.publishReady;
  const metricsNextAction = typeof metrics.nextAction === 'string' && metrics.nextAction.trim().length > 0
    ? metrics.nextAction.trim()
    : undefined;
  const nextAction = metricsNextAction && metricsNextAction !== 'Ready for publish handoff.'
    ? metricsNextAction
    : reviewFindingsNextAction(value);

  if (verdict === 'retry' || verdict === 'fail') {
    return `Review report is not publish-ready: verdict ${verdict}; next action: ${nextAction}`;
  }
  if (verdict === 'pass' && publishReady !== true) {
    return `Review report is not publish-ready: metrics.publishReady is not true; next action: ${nextAction}`;
  }
  return null;
}

function reviewFindingsNextAction(value: Record<string, unknown>): string {
  const findings = Array.isArray(value.findings)
    ? value.findings.filter((finding): finding is string => typeof finding === 'string' && finding.trim().length > 0)
    : [];
  if (findings.length) return `Resolve review findings: ${sentenceText(findings.join('; '))}.`;
  return 'Resolve review findings before publishing.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sentenceText(value: string): string {
  return value.trim().replace(/[.!?]+$/u, '');
}
