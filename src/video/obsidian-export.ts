import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { artifactPathFor } from './artifact-store.js';
import { listCharacterProfiles } from './characters.js';
import { buildProjectScorecard } from './scorecard.js';
import { deriveDueRisk } from './scheduling.js';
import { buildProjectStatusReport } from './status.js';
import { deriveProjectOpsStatus } from './project-index.js';
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import { findRoleCollisions, sheetsCoveringScene } from './reference-sheets.js';
import {
  readSceneCandidatesArtifact,
  sceneCandidatesPathFor,
} from './scene-candidate-store.js';
import { readSceneSelectionArtifact } from './scene-selection-store.js';
import { readProjectManifest, resolveProjectWorkspace } from './workspace.js';
import type {
  ReferenceSheetsArtifact,
  SceneCandidatesArtifact,
  SceneSelectionArtifact,
  VideoProductionMode,
} from './types.js';

export interface ObsidianExportResult {
  slug: string;
  outputPath: string;
  sceneNotePaths: string[];
}

interface StoryboardSceneLike {
  sceneIndex?: number;
  description?: string;
  characters?: string[];
  dialogue?: string;
  durationSeconds?: number;
}

function buildSceneNoteMarkdown(input: {
  slug: string;
  sceneIndex: number;
  scene?: StoryboardSceneLike;
  candidates: SceneCandidatesArtifact;
  selection: SceneSelectionArtifact;
  referenceSheets: ReferenceSheetsArtifact;
}): string {
  const { slug, sceneIndex, scene, candidates, selection, referenceSheets } = input;
  const entry = candidates.scenes.find((s) => s.sceneIndex === sceneIndex);
  const sel = selection.scenes.find((s) => s.sceneIndex === sceneIndex);
  const covering = sheetsCoveringScene(referenceSheets, sceneIndex);
  const selectedId = sel?.selectedCandidateId ?? null;

  const lines: string[] = [];
  lines.push('---');
  lines.push(`title: ${JSON.stringify(`${slug} / Scene ${sceneIndex}`)}`);
  lines.push(`slug: ${JSON.stringify(slug)}`);
  lines.push(`scene_index: ${sceneIndex}`);
  lines.push(`selected_candidate_id: ${selectedId ? JSON.stringify(selectedId) : 'null'}`);
  lines.push(`reroll_requested: ${sel?.rerollRequested ? 'true' : 'false'}`);
  lines.push(`chain_from_prev: ${sel?.chainFromPrev ? 'true' : 'false'}`);
  lines.push(`candidate_count: ${entry?.candidates.length ?? 0}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Scene ${sceneIndex}`);
  lines.push('');

  lines.push('## Prompt');
  lines.push('');
  lines.push(scene?.description && scene.description.trim().length > 0
    ? scene.description
    : '_No storyboard description._');
  lines.push('');

  lines.push('## Characters');
  lines.push('');
  const characters = scene?.characters ?? [];
  if (characters.length === 0) {
    lines.push('- none');
  } else {
    for (const name of characters) {
      lines.push(`- [[Projects/${slug}|${name}]]`);
    }
  }
  lines.push('');

  lines.push('## Reference Sheets');
  lines.push('');
  if (covering.length === 0) {
    lines.push('- none');
  } else {
    for (const sheet of covering) {
      const roles = Array.from(new Set(sheet.references.map((ref) => ref.role))).join(', ') || '(none)';
      lines.push(`- ${sheet.id} (${sheet.type}) | roles: ${roles}${sheet.name ? ` | ${sheet.name}` : ''}`);
    }
  }
  lines.push('');

  lines.push('## Candidates');
  lines.push('');
  if (!entry || entry.candidates.length === 0) {
    lines.push('- none');
  } else {
    lines.push('| Take | Round | Status | Output path | Selected? |');
    lines.push('|---|---|---|---|---|');
    for (const candidate of entry.candidates) {
      const outputPath = candidate.outputs[0]?.path ?? '—';
      const marker = candidate.id === selectedId ? '✅' : '—';
      lines.push(`| ${candidate.id} | ${candidate.generationRound} | ${candidate.status} | ${outputPath} | ${marker} |`);
    }
  }
  lines.push('');

  lines.push('## Selection State');
  lines.push('');
  lines.push(`- Selected candidate: \`${selectedId ?? 'none'}\``);
  lines.push(`- Pending: ${sel?.pendingCandidateIds.length ? sel.pendingCandidateIds.join(', ') : 'none'}`);
  lines.push(`- Rejected: ${sel?.rejectedCandidateIds.length ? sel.rejectedCandidateIds.join(', ') : 'none'}`);
  lines.push(`- Reroll requested: ${sel?.rerollRequested ? 'yes' : 'no'}`);
  lines.push(`- Chain from previous scene: ${sel?.chainFromPrev ? 'yes' : 'no'}`);
  lines.push('');

  return `${lines.join('\n')}\n`;
}

async function loadStoryboardScenes(
  workspace: ReturnType<typeof resolveProjectWorkspace>,
): Promise<StoryboardSceneLike[]> {
  const storyboardPath = artifactPathFor(workspace, 'storyboard');
  if (!existsSync(storyboardPath)) return [];
  try {
    const raw = JSON.parse(await readFile(storyboardPath, 'utf-8')) as {
      scenes?: StoryboardSceneLike[];
    };
    return raw.scenes ?? [];
  } catch {
    return [];
  }
}

function toYamlList(items: string[]): string[] {
  if (items.length === 0) return ['[]'];
  return items.map((item) => `  - ${JSON.stringify(item)}`);
}

export async function exportProjectToObsidian(
  slug: string,
  options: {
    root?: string;
    outputDir?: string;
    productionMode?: VideoProductionMode;
  } = {},
): Promise<ObsidianExportResult> {
  const root = options.root ?? process.cwd();
  const projectWorkspace = resolveProjectWorkspace(slug, root);
  const projectManifest = await readProjectManifest(projectWorkspace);
  const productionMode = projectManifest?.productionMode ?? options.productionMode ?? 'storyboard';
  const status = await buildProjectStatusReport(slug, root, productionMode);
  const characters = await listCharacterProfiles(projectWorkspace);
  const referenceSheetsArtifact = await readReferenceSheetsArtifact(projectWorkspace.root, slug);
  const referenceSheetCollisions = findRoleCollisions(referenceSheetsArtifact).length > 0;
  const referenceSheetTypes = Object.keys(status.referenceSheets?.byType ?? {});
  const scorecard = buildProjectScorecard({ status, manifest: projectManifest });
  const dueRisk = deriveDueRisk(projectManifest?.dueDate);
  const opsStatus = deriveProjectOpsStatus(status);
  const outputDir = resolve(options.outputDir ?? join(root, 'ops', 'obsidian', 'Projects'));
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${slug}.md`);

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(slug)}`,
    `slug: ${JSON.stringify(slug)}`,
    `production_mode: ${JSON.stringify(status.productionMode)}`,
    `target_runtime_seconds: ${typeof status.targetRuntimeSeconds === 'number' ? status.targetRuntimeSeconds : 'null'}`,
    `clip_duration_seconds: ${typeof status.clipDurationSeconds === 'number' ? status.clipDurationSeconds : 'null'}`,
    `genre: ${status.genre ? JSON.stringify(status.genre) : 'null'}`,
    `platform: ${status.platform ? JSON.stringify(status.platform) : 'null'}`,
    `style: ${status.style ? JSON.stringify(status.style) : 'null'}`,
    `color_grading: ${status.colorGrading ? JSON.stringify(status.colorGrading) : 'null'}`,
    `legacy_import_manifest_present: ${typeof status.legacyImportSummary?.manifestPresent === 'boolean' ? String(status.legacyImportSummary.manifestPresent) : 'null'}`,
    `legacy_import_queue_file_present: ${typeof status.legacyImportSummary?.queueFilePresent === 'boolean' ? String(status.legacyImportSummary.queueFilePresent) : 'null'}`,
    `legacy_import_queue_status_mismatch: ${typeof status.legacyImportSummary?.queueStatusMismatch === 'boolean' ? String(status.legacyImportSummary.queueStatusMismatch) : 'null'}`,
    `legacy_import_nested_output_root_detected: ${typeof status.legacyImportSummary?.nestedOutputRootDetected === 'boolean' ? String(status.legacyImportSummary.nestedOutputRootDetected) : 'null'}`,
    `ops_status: ${JSON.stringify(opsStatus)}`,
    `score: ${scorecard.score}`,
    `score_band: ${JSON.stringify(scorecard.band)}`,
    `owner: ${projectManifest?.owner ? JSON.stringify(projectManifest.owner) : 'null'}`,
    `priority: ${projectManifest?.priority ? JSON.stringify(projectManifest.priority) : 'null'}`,
    `due_date: ${projectManifest?.dueDate ? JSON.stringify(projectManifest.dueDate) : 'null'}`,
    `due_risk: ${JSON.stringify(dueRisk)}`,
    `blocked_reason: ${projectManifest?.blockedReason ? JSON.stringify(projectManifest.blockedReason) : 'null'}`,
    `execution_profile_aspect_ratio: ${status.executionProfile?.aspectRatio ? JSON.stringify(status.executionProfile.aspectRatio) : 'null'}`,
    `execution_profile_quality: ${status.executionProfile?.quality ? JSON.stringify(status.executionProfile.quality) : 'null'}`,
    `execution_profile_resolution: ${status.executionProfile?.resolution ? JSON.stringify(status.executionProfile.resolution) : 'null'}`,
    `execution_profile_audio: ${typeof status.executionProfile?.generateAudio === 'boolean' ? String(status.executionProfile.generateAudio) : 'null'}`,
    `execution_profile_outputs: ${typeof status.executionProfile?.outputCount === 'number' ? status.executionProfile.outputCount : 'null'}`,
    'tags:',
    ...toYamlList(projectManifest?.tags ?? []),
    'blocked_by:',
    ...toYamlList(projectManifest?.blockedBy ?? []),
    `project_exists: ${status.projectExists}`,
    `next_stage: ${status.nextStage === null ? 'null' : JSON.stringify(status.nextStage)}`,
    `storyboard_review_state: ${status.storyboardReviewState ? JSON.stringify(status.storyboardReviewState) : 'null'}`,
    `storyboard_review_exists: ${typeof status.storyboardReviewExists === 'boolean' ? String(status.storyboardReviewExists) : 'null'}`,
    `storyboard_review_path: ${status.storyboardReviewPath ? JSON.stringify(status.storyboardReviewPath) : 'null'}`,
    `storyboard_review_generated_at: ${status.storyboardReviewGeneratedAt ? JSON.stringify(status.storyboardReviewGeneratedAt) : 'null'}`,
    `storyboard_review_stale: ${typeof status.storyboardReviewStale === 'boolean' ? String(status.storyboardReviewStale) : 'null'}`,
    `review_report_verdict: ${status.reviewReportVerdict ? JSON.stringify(status.reviewReportVerdict) : 'null'}`,
    `review_publish_ready: ${typeof status.reviewPublishReady === 'boolean' ? String(status.reviewPublishReady) : 'null'}`,
    `completed_stage_count: ${status.completedStages.length}`,
    `pending_stage_count: ${status.pendingStages.length}`,
    `artifact_count: ${status.artifactFiles.length}`,
    `checkpoint_count: ${status.checkpoints.length}`,
    `referenceSheetCount: ${status.referenceSheets?.count ?? 0}`,
    `referenceSheetTypes: ${JSON.stringify(referenceSheetTypes.join(','))}`,
    `referenceSheetCollisions: ${referenceSheetCollisions}`,
    `sceneSelectionCoverage: ${JSON.stringify(`${status.sceneSelection?.withSelection ?? 0}/${status.sceneSelection?.sceneCount ?? 0}`)}`,
    `sceneCandidatesTotal: ${status.sceneSelection?.totalCandidates ?? 0}`,
    'completed_stages:',
    ...toYamlList(status.completedStages),
    'pending_stages:',
    ...toYamlList(status.pendingStages),
    'artifact_files:',
    ...toYamlList(status.artifactFiles),
    'characters:',
    ...toYamlList(characters.map((character) => character.name)),
    'character_bindings:',
    ...toYamlList((status.characterBindings ?? []).map((binding) => `${binding.name}:${binding.goBananasId ?? 'none'}:${binding.referenceAssets.join('&') || 'none'}`)),
    'prompt_guidance:',
    ...toYamlList((status.promptGuidance ?? []).map((entry) => entry.name)),
    '---',
  ].join('\n');

  const body = [
    `# ${slug}`,
    '',
    '## Summary',
    '',
    `- Ops status: \`${opsStatus}\``,
    `- Score: \`${scorecard.score}\` (${scorecard.band})`,
    `- Production mode: \`${status.productionMode}\``,
    `- Target runtime: ${typeof status.targetRuntimeSeconds === 'number' ? `\`${status.targetRuntimeSeconds}s\`` : '`unset`'}`,
    `- Clip duration: ${typeof status.clipDurationSeconds === 'number' ? `\`${status.clipDurationSeconds}s\`` : '`unset`'}`,
    `- Genre: ${status.genre ? `\`${status.genre}\`` : '`unset`'}`,
    `- Platform: ${status.platform ? `\`${status.platform}\`` : '`unset`'}`,
    `- Style: ${status.style ? `\`${status.style}\`` : '`unset`'}`,
    `- Color grading: ${status.colorGrading ? `\`${status.colorGrading}\`` : '`unset`'}`,
    `- Legacy import diagnostics: ${status.legacyImportSummary
      ? `\`manifest=${status.legacyImportSummary.manifestPresent} | queue-file=${status.legacyImportSummary.queueFilePresent} | queue-drift=${status.legacyImportSummary.queueStatusMismatch} | nested-output=${status.legacyImportSummary.nestedOutputRootDetected}\``
      : '`none`'}`,
    `- Owner: ${projectManifest?.owner ? `\`${projectManifest.owner}\`` : '`unassigned`'}`,
    `- Priority: ${projectManifest?.priority ? `\`${projectManifest.priority}\`` : '`unset`'}`,
    `- Due date: ${projectManifest?.dueDate ? `\`${projectManifest.dueDate}\`` : '`unset`'}`,
    `- Due risk: \`${dueRisk}\``,
    `- Blocked reason: ${projectManifest?.blockedReason ? `\`${projectManifest.blockedReason}\`` : '`none`'}`,
    `- Execution profile: ${status.executionProfile ? `\`${status.executionProfile.aspectRatio ?? 'unset'} | ${status.executionProfile.quality ?? 'unset'} | ${status.executionProfile.resolution ?? 'unset'} | audio=${status.executionProfile.generateAudio ?? 'unset'} | outputs=${status.executionProfile.outputCount ?? 'unset'}\`` : '`unset`'}`,
    `- Next stage: ${status.nextStage === null ? '`complete`' : `\`${status.nextStage}\``}`,
    `- Storyboard review state: ${status.storyboardReviewState ? `\`${status.storyboardReviewState}\`` : '`unset`'}`,
    `- Storyboard review exists: ${typeof status.storyboardReviewExists === 'boolean' ? `\`${status.storyboardReviewExists}\`` : '`unset`'}`,
    `- Storyboard review: ${status.storyboardReviewPath ? `[storyboard.md](${status.storyboardReviewPath})` : '`unset`'}`,
    `- Storyboard review generated: ${status.storyboardReviewGeneratedAt ? `\`${status.storyboardReviewGeneratedAt}\`` : '`unset`'}`,
    `- Storyboard review stale: ${typeof status.storyboardReviewStale === 'boolean' ? `\`${status.storyboardReviewStale}\`` : '`unset`'}`,
    `- Review report verdict: ${status.reviewReportVerdict ? `\`${status.reviewReportVerdict}\`` : '`unset`'}`,
    `- Review publish ready: ${typeof status.reviewPublishReady === 'boolean' ? `\`${status.reviewPublishReady}\`` : '`unset`'}`,
    `- Completed stages: ${status.completedStages.length}`,
    `- Pending stages: ${status.pendingStages.length}`,
    '',
    '## Checkpoints',
    '',
    ...status.checkpoints.map((checkpoint) => (
      `- \`${checkpoint.stage}\` -> \`${checkpoint.status}\` (${checkpoint.generatedAt})${checkpoint.nextAction ? ` | next: ${checkpoint.nextAction}` : ''}`
    )),
    '',
    '## Artifact Files',
    '',
    ...status.artifactFiles.map((file) => `- ${file}`),
    '',
    '## Prompt Guidance',
    '',
    ...((status.promptGuidance ?? []).length > 0
      ? (status.promptGuidance ?? []).map((entry) => `- ${entry.name} | ${entry.reason}`)
      : ['- none']),
    '',
    '## Characters',
    '',
    ...(characters.length > 0
      ? characters.map((character) => `- ${character.name}${character.description ? ` | ${character.description}` : ''}${character.referenceAssets.length > 0 ? ` | refs: ${character.referenceAssets.join(', ')}` : ''}`)
      : ['- none']),
    '',
    '## Character Bindings',
    '',
    ...((status.characterBindings ?? []).length > 0
      ? (status.characterBindings ?? []).map((binding) => `- ${binding.name} | gb=${binding.goBananasId ?? 'none'} | refs: ${binding.referenceAssets.join(', ') || 'none'} | profile=${binding.profileExists}`)
      : ['- none']),
  ].join('\n');

  await writeFile(outputPath, `${frontmatter}\n\n${body}\n`);

  // Per-scene notes (feature-gated on the scene-candidates artifact). Notes go
  // to <outputDir>/<slug>/Scenes/<i>.md and are regenerated each export.
  const sceneNotePaths: string[] = [];
  if (existsSync(sceneCandidatesPathFor(projectWorkspace.root, slug))) {
    const sceneCandidates = await readSceneCandidatesArtifact(projectWorkspace.root, slug);
    if (sceneCandidates.scenes.length > 0) {
      const sceneSelection = await readSceneSelectionArtifact(projectWorkspace.root, slug);
      const storyboardScenes = await loadStoryboardScenes(projectWorkspace);
      const sceneByIndex = new Map<number, StoryboardSceneLike>();
      for (const [i, scene] of storyboardScenes.entries()) {
        const sceneIndex = typeof scene.sceneIndex === 'number' ? scene.sceneIndex : i;
        sceneByIndex.set(sceneIndex, scene);
      }
      const scenesDir = join(outputDir, slug, 'Scenes');
      await mkdir(scenesDir, { recursive: true });
      for (const entry of sceneCandidates.scenes) {
        if (entry.candidates.length === 0) continue;
        const sceneMarkdown = buildSceneNoteMarkdown({
          slug,
          sceneIndex: entry.sceneIndex,
          scene: sceneByIndex.get(entry.sceneIndex),
          candidates: sceneCandidates,
          selection: sceneSelection,
          referenceSheets: referenceSheetsArtifact,
        });
        const scenePath = join(scenesDir, `${entry.sceneIndex}.md`);
        await writeFile(scenePath, sceneMarkdown);
        sceneNotePaths.push(scenePath);
      }
    }
  }

  return {
    slug,
    outputPath,
    sceneNotePaths,
  };
}
