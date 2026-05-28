import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { artifactPathFor } from './artifact-store.js';
import { listCharacterProfiles } from './characters.js';
import { readProjectEvents } from './events.js';
import { getBuiltinPipelineManifest } from './pipeline-manifest.js';
import { getNextStage, readStageCheckpoint } from './checkpoints.js';
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import { summarizeArtifact, type ArtifactSummary } from './reference-sheets.js';
import { readSceneCandidatesArtifact } from './scene-candidate-store.js';
import { readSceneSelectionArtifact } from './scene-selection-store.js';
import { summarizeSceneSelection, type SceneSelectionSummary } from './scene-selection.js';
import { readMultiShotPromptArtifactSummary, type MultiShotPromptArtifactSummary } from './multi-shot-artifact.js';
import { readProjectManifest, resolveProjectWorkspace } from './workspace.js';
import type { LegacyImportSummary, VideoProductionMode } from './types.js';

export interface VideoProjectStatusReport {
  slug: string;
  root: string;
  productionMode: VideoProductionMode;
  projectExists: boolean;
  nextStage: string | null;
  targetRuntimeSeconds?: number;
  clipDurationSeconds?: number;
  genre?: string;
  platform?: string;
  style?: string;
  colorGrading?: string;
  legacyImportSummary?: LegacyImportSummary;
  storyboardReviewState?: 'missing' | 'current' | 'stale';
  storyboardReviewPath?: string;
  storyboardReviewExists?: boolean;
  storyboardReviewGeneratedAt?: string;
  storyboardReviewStale?: boolean;
  reviewReportVerdict?: string;
  reviewPublishReady?: boolean;
  executionProfile?: {
    aspectRatio?: string;
    quality?: string;
    resolution?: string;
    generateAudio?: boolean;
    outputCount?: number;
  };
  promptGuidance?: Array<{
    name: string;
    reason: string;
    category: 'provider' | 'framework';
  }>;
  characterProfiles?: Array<{
    name: string;
    goBananasId?: number;
    referenceAssets: string[];
    notes?: string[];
  }>;
  characterHydrationSummary?: {
    totalProfiles: number;
    explicitCount: number;
    importedCount: number;
    autoCreatedCount: number;
  };
  characterBindings?: Array<{
    name: string;
    goBananasId?: number;
    referenceAssets: string[];
    profileExists: boolean;
  }>;
  completedStages: string[];
  pendingStages: string[];
  artifactFiles: string[];
  checkpoints: Array<{
    stage: string;
    status: string;
    generatedAt: string;
    nextAction?: string;
  }>;
  referenceSheets: ArtifactSummary;
  sceneSelection: SceneSelectionSummary;
  multiShotPrompt?: MultiShotPromptArtifactSummary;
}

export async function buildProjectStatusReport(
  slug: string,
  root = process.cwd(),
  productionMode: VideoProductionMode = 'storyboard',
): Promise<VideoProjectStatusReport> {
  const workspace = resolveProjectWorkspace(slug, root);
  const projectExists = existsSync(workspace.projectDir);
  const storyboardReviewPath = join(workspace.projectDir, 'storyboard.md');
  const projectManifest = projectExists ? await readProjectManifest(workspace) : null;
  const resolvedMode = projectManifest?.productionMode ?? productionMode;
  const manifest = getBuiltinPipelineManifest(resolvedMode);

  if (!projectExists) {
    return {
      slug,
      root: workspace.root,
      productionMode: resolvedMode,
      projectExists: false,
      nextStage: manifest.stages[0]?.name ?? null,
      completedStages: [],
      pendingStages: manifest.stages.map((stage) => stage.name),
      artifactFiles: [],
      checkpoints: [],
      referenceSheets: { count: 0, byType: {}, boundSceneCount: 0, unboundSheetIds: [] },
      sceneSelection: {
        sceneCount: 0,
        withSelection: 0,
        withPending: 0,
        withReroll: 0,
        totalCandidates: 0,
        rejectedCount: 0,
      },
    };
  }

  const referenceSheets = summarizeArtifact(await readReferenceSheetsArtifact(workspace.root, slug));
  const sceneSelection = summarizeSceneSelection(
    await readSceneCandidatesArtifact(workspace.root, slug),
    await readSceneSelectionArtifact(workspace.root, slug),
  );
  const multiShotPrompt = await readMultiShotPromptArtifactSummary(workspace);

  const checkpoints = [];
  let completedStages: string[] = [];
  const reviewReportPath = artifactPathFor(workspace, 'review-report');
  const reviewReport = existsSync(reviewReportPath)
    ? JSON.parse(await readFile(reviewReportPath, 'utf-8')) as unknown
    : null;
  const reviewReportRecord = isRecord(reviewReport) ? reviewReport : null;
  const reviewReportVerdict = typeof reviewReportRecord?.verdict === 'string'
    ? reviewReportRecord.verdict
    : undefined;
  const reviewReportMetrics = isRecord(reviewReportRecord?.metrics) ? reviewReportRecord.metrics : {};
  const reviewPublishReady = reviewReportRecord
    ? reviewReportVerdict === 'pass' && reviewReportMetrics.publishReady === true
    : undefined;

  for (const stage of manifest.stages) {
    const checkpoint = await readStageCheckpoint(workspace, stage.name);
    if (!checkpoint) continue;
    checkpoints.push({
      stage: checkpoint.stage,
      status: checkpoint.status,
      generatedAt: checkpoint.generatedAt,
      nextAction: checkpoint.stage === 'review'
        ? canonicalReviewCheckpointNextAction(checkpoint.status, checkpoint.nextAction, reviewReport)
        : checkpoint.nextAction,
    });
    if (checkpoint.status === 'completed') {
      completedStages.push(stage.name);
    }
  }

  let nextStage = await getNextStage(workspace, manifest);
  const briefPath = artifactPathFor(workspace, 'brief');
  const executionPlanPath = artifactPathFor(workspace, 'execution-plan');
  const storyboardPath = artifactPathFor(workspace, 'storyboard');
  const legacyImportSummaryPath = join(workspace.stateDir, 'legacy-import-summary.json');
  const briefArtifact = existsSync(briefPath)
    ? JSON.parse(await readFile(briefPath, 'utf-8')) as {
      metadata?: {
          targetRuntimeSeconds?: number;
          clipDurationSeconds?: number;
          genre?: string;
          platform?: string;
          style?: string;
          colorGrading?: string;
          executionProfile?: VideoProjectStatusReport['executionProfile'];
        };
      }
    : null;
  const executionPlan = existsSync(executionPlanPath)
    ? JSON.parse(await readFile(executionPlanPath, 'utf-8')) as { promptGuidance?: VideoProjectStatusReport['promptGuidance'] }
    : null;
  const storyboardArtifact = existsSync(storyboardPath)
    ? JSON.parse(await readFile(storyboardPath, 'utf-8')) as { scenes?: Array<{ characters?: string[] }> }
    : null;
  const legacyImportSummary = existsSync(legacyImportSummaryPath)
    ? JSON.parse(await readFile(legacyImportSummaryPath, 'utf-8')) as LegacyImportSummary
    : null;
  const projectEvents = await readProjectEvents(workspace);
  const reviewEvents = projectEvents.filter((event) => event.type === 'storyboard.review.generated');
  const latestReviewEvent = reviewEvents[0]
    ? reviewEvents.reduce((latest, current) => current.recordedAt > latest.recordedAt ? current : latest)
    : null;
  const storyboardWriteEvents = projectEvents.filter((event) => event.type === 'artifact.storyboard.written');
  const latestStoryboardWriteEvent = storyboardWriteEvents[0]
    ? storyboardWriteEvents.reduce((latest, current) => current.recordedAt > latest.recordedAt ? current : latest)
    : null;
  const storyboardReviewStale = latestReviewEvent
    ? (latestStoryboardWriteEvent ? latestStoryboardWriteEvent.recordedAt > latestReviewEvent.recordedAt : false)
    : undefined;
  const storyboardReviewState = latestReviewEvent
    ? (storyboardReviewStale ? 'stale' : 'current')
    : (existsSync(storyboardReviewPath) ? 'missing' : undefined);

  if (checkpoints.length === 0 && projectManifest) {
    const lastCompletedStage = projectManifest.lastCompletedStage;
    if (lastCompletedStage) {
      const lastCompletedIndex = manifest.stages.findIndex((stage) => stage.name === lastCompletedStage);
      if (lastCompletedIndex >= 0) {
        completedStages = manifest.stages.slice(0, lastCompletedIndex + 1).map((stage) => stage.name);
      }
    }
    if (projectManifest.currentStage !== undefined) {
      nextStage = projectManifest.currentStage;
    }
  }

  const pendingStages = nextStage === null
    ? []
    : manifest.stages
        .map((stage) => stage.name)
        .filter((stage) => !completedStages.includes(stage));

  const artifactFiles = existsSync(workspace.artifactsDir)
    ? (await readdir(workspace.artifactsDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort()
        .map((file) => join(workspace.artifactsDir, file))
    : [];

  const referencedCharacters = [
    ...new Set(
      (storyboardArtifact?.scenes ?? [])
        .flatMap((scene) => scene.characters ?? [])
        .map((name) => String(name).trim())
        .filter(Boolean),
    ),
  ];
  const profiles = await listCharacterProfiles(workspace);
  const profileMap = new Map(
    profiles.flatMap((profile) => [
      [profile.id.toLowerCase(), profile] as const,
      [profile.name.toLowerCase(), profile] as const,
    ]),
  );
  const characterProfiles = profiles.map((profile) => ({
    name: profile.name,
    ...(profile.goBananasId !== undefined ? { goBananasId: profile.goBananasId } : {}),
    referenceAssets: profile.referenceAssets,
    ...(profile.notes ? { notes: profile.notes } : {}),
  }));
  const hasNoteFragment = (profile: typeof profiles[number], fragment: string): boolean =>
    (profile.notes ?? []).some((note) => note.includes(fragment));
  const characterHydrationSummary = profiles.length > 0
    ? {
        totalProfiles: profiles.length,
        explicitCount: profiles.filter((profile) => hasNoteFragment(profile, '--gb-character')).length,
        importedCount: profiles.filter((profile) => hasNoteFragment(profile, '--import-library-characters')).length,
        autoCreatedCount: profiles.filter((profile) => hasNoteFragment(profile, '--auto-create-characters')).length,
      }
    : undefined;
  const characterBindings = referencedCharacters.map((name) => {
    const profile = profileMap.get(name.toLowerCase());
    return {
      name,
      ...(profile?.goBananasId !== undefined ? { goBananasId: profile.goBananasId } : {}),
      referenceAssets: profile?.referenceAssets ?? [],
      profileExists: Boolean(profile),
    };
  });

  return {
    slug,
    root: workspace.root,
    productionMode: resolvedMode,
    projectExists: true,
    nextStage,
    ...(briefArtifact?.metadata?.targetRuntimeSeconds ? { targetRuntimeSeconds: briefArtifact.metadata.targetRuntimeSeconds } : {}),
    ...(briefArtifact?.metadata?.clipDurationSeconds ? { clipDurationSeconds: briefArtifact.metadata.clipDurationSeconds } : {}),
    ...(briefArtifact?.metadata?.genre ? { genre: briefArtifact.metadata.genre } : {}),
    ...(briefArtifact?.metadata?.platform ? { platform: briefArtifact.metadata.platform } : {}),
    ...(briefArtifact?.metadata?.style ? { style: briefArtifact.metadata.style } : {}),
    ...(briefArtifact?.metadata?.colorGrading ? { colorGrading: briefArtifact.metadata.colorGrading } : {}),
    ...(legacyImportSummary ? { legacyImportSummary } : {}),
    ...(storyboardReviewState ? { storyboardReviewState } : {}),
    ...(reviewEvents.length > 0 ? { storyboardReviewExists: true } : {}),
    ...(existsSync(storyboardReviewPath) ? { storyboardReviewPath } : {}),
    ...(latestReviewEvent ? { storyboardReviewGeneratedAt: latestReviewEvent.recordedAt } : {}),
    ...(storyboardReviewStale !== undefined ? { storyboardReviewStale } : {}),
    ...(reviewReportVerdict ? { reviewReportVerdict } : {}),
    ...(reviewPublishReady !== undefined ? { reviewPublishReady } : {}),
    ...(briefArtifact?.metadata?.executionProfile ? { executionProfile: briefArtifact.metadata.executionProfile } : {}),
    ...(executionPlan?.promptGuidance ? { promptGuidance: executionPlan.promptGuidance } : {}),
    ...(characterProfiles.length > 0 ? { characterProfiles } : {}),
    ...(characterHydrationSummary ? { characterHydrationSummary } : {}),
    ...(characterBindings.length > 0 ? { characterBindings } : {}),
    completedStages,
    pendingStages,
    artifactFiles,
    checkpoints,
    referenceSheets,
    sceneSelection,
    ...(multiShotPrompt ? { multiShotPrompt } : {}),
  };
}

function canonicalReviewCheckpointNextAction(
  status: string,
  nextAction: string | undefined,
  reviewReport: unknown,
): string | undefined {
  if (status === 'completed') {
    return reviewNotPublishReadyAction(reviewReport) ?? nextAction;
  }
  if (nextAction && nextAction !== 'Ready for publish handoff.') return nextAction;
  const report = isRecord(reviewReport) ? reviewReport : {};
  const metrics = isRecord(report.metrics) ? report.metrics : {};
  const metricsNextAction = typeof metrics.nextAction === 'string' ? metrics.nextAction : undefined;
  if (metricsNextAction && metricsNextAction !== 'Ready for publish handoff.') return metricsNextAction;
  const findings = Array.isArray(report.findings)
    ? report.findings.filter((finding): finding is string => typeof finding === 'string' && Boolean(finding))
    : [];
  if (findings.length) return `Resolve review findings: ${sentenceText(findings.join('; '))}.`;
  return 'Resolve review findings before publishing.';
}

function reviewNotPublishReadyAction(reviewReport: unknown): string | undefined {
  if (!isRecord(reviewReport)) return undefined;
  const metrics = isRecord(reviewReport.metrics) ? reviewReport.metrics : {};
  if (reviewReport.verdict === 'pass' && metrics.publishReady === true) return undefined;
  const metricsNextAction = typeof metrics.nextAction === 'string' && metrics.nextAction !== 'Ready for publish handoff.'
    ? metrics.nextAction
    : undefined;
  if (metricsNextAction) return metricsNextAction;
  const findings = Array.isArray(reviewReport.findings)
    ? reviewReport.findings.filter((finding): finding is string => typeof finding === 'string' && Boolean(finding))
    : [];
  if (findings.length) return `Resolve review findings: ${sentenceText(findings.join('; '))}.`;
  return 'Restore review publish readiness before publishing.';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sentenceText(value: string): string {
  return value.trim().replace(/[.!?]+$/u, '');
}
