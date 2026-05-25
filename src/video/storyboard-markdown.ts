import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactPathFor } from './artifact-store.js';
import { listCharacterProfiles, type CharacterProfile } from './characters.js';
import type { VideoCostEstimate } from './cost-estimate.js';
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import { sheetsCoveringScene } from './reference-sheets.js';
import { readSceneCandidatesArtifact } from './scene-candidate-store.js';
import { readSceneSelectionArtifact } from './scene-selection-store.js';
import { resolveProjectWorkspace } from './workspace.js';
import type { DirectorPreflightResult } from './director-preflight.js';
import type {
  ReferenceSheetsArtifact,
  SceneCandidatesArtifact,
  SceneSelectionArtifact,
  VideoExecutionPlan,
} from './types.js';

interface BriefArtifactForMarkdown {
  title: string;
  intent: string;
  productionMode: 'storyboard' | 'director';
  metadata?: {
    targetRuntimeSeconds?: number;
    genre?: string;
    platform?: string;
    style?: string;
    colorGrading?: string;
  };
}

interface StoryboardArtifactForMarkdown {
  projectSlug: string;
  productionMode: 'storyboard' | 'director';
  scenes: Array<{
    sceneIndex: number;
    description: string;
    scenePrompt?: {
      imagePrompt?: string;
      animationPrompt?: string;
      cameraMove?: 'push-in' | 'pull-out' | 'tracking' | 'crane' | 'orbit' | 'static';
      styleFooter?: string;
    };
    characters?: string[];
    dialogue?: string;
    durationSeconds?: number;
  }>;
}

function collectReferencedCharacters(storyboard: StoryboardArtifactForMarkdown): string[] {
  return [
    ...new Set(
      storyboard.scenes
        .flatMap((scene) => scene.characters ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function buildReferenceSheetsSectionLines(
  storyboard: StoryboardArtifactForMarkdown,
  artifact?: ReferenceSheetsArtifact,
): string[] {
  if (!artifact || artifact.sheets.length === 0) {
    return [];
  }
  const lines: string[] = [];
  lines.push('## Reference sheets');
  lines.push('');
  lines.push('| Scene | Sheet | Type | Role(s) | Character |');
  lines.push('|---|---|---|---|---|');
  for (const [i, scene] of storyboard.scenes.entries()) {
    const sceneIndex = typeof scene.sceneIndex === 'number' ? scene.sceneIndex : i;
    const covering = sheetsCoveringScene(artifact, sceneIndex);
    for (const sheet of covering) {
      const roles = Array.from(new Set(sheet.references.map((ref) => ref.role))).join(', ') || '(none)';
      const character = sheet.characterName ?? '(none)';
      const sheetLabel = sheet.name
        ? `${sheet.name} (${sheet.id})`
        : sheet.id;
      const refDetails = sheet.references
        .map((ref) => ('gbRef' in ref ? `gb:${ref.gbRef.kind}:${ref.gbRef.id}` : ref.path))
        .join(', ');
      const sheetCell = refDetails ? `${sheetLabel} — ${refDetails}` : sheetLabel;
      lines.push(`| ${sceneIndex + 1} | ${sheetCell} | ${sheet.type} | ${roles} | ${character} |`);
    }
  }
  lines.push('');
  return lines;
}

function buildCandidatesSectionLines(
  storyboard: StoryboardArtifactForMarkdown,
  candidates?: SceneCandidatesArtifact,
  selection?: SceneSelectionArtifact,
): string[] {
  if (!candidates || candidates.scenes.length === 0) return [];
  const selectionByScene = new Map<number, SceneSelectionArtifact['scenes'][number]>();
  if (selection) {
    for (const entry of selection.scenes) {
      selectionByScene.set(entry.sceneIndex, entry);
    }
  }

  const lines: string[] = [];
  let sectionEmitted = false;
  for (const [i, scene] of storyboard.scenes.entries()) {
    const sceneIndex = typeof scene.sceneIndex === 'number' ? scene.sceneIndex : i;
    const entry = candidates.scenes.find((s) => s.sceneIndex === sceneIndex);
    if (!entry || entry.candidates.length === 0) continue;

    const sel = selectionByScene.get(sceneIndex);
    const selectedId = sel?.selectedCandidateId ?? null;
    const chain = sel?.chainFromPrev ?? false;
    const reroll = sel?.rerollRequested ?? false;

    if (!sectionEmitted) {
      lines.push('## Candidates & selection');
      lines.push('');
      sectionEmitted = true;
    }
    lines.push(`### Scene ${sceneIndex} — candidates`);
    lines.push('');
    lines.push('| Take | Round | Status | Selected? |');
    lines.push('|---|---|---|---|');
    for (const candidate of entry.candidates) {
      const marker = candidate.id === selectedId ? '✅' : '—';
      lines.push(`| ${candidate.id} | ${candidate.generationRound} | ${candidate.status} | ${marker} |`);
    }
    lines.push('');
    lines.push(`Chain from prev: ${chain ? 'yes' : 'no'}`);
    lines.push(`Reroll requested: ${reroll ? 'yes' : 'no'}`);
    lines.push('');
  }
  return lines;
}

function buildCharacterBindingLines(
  storyboard: StoryboardArtifactForMarkdown,
  profiles: CharacterProfile[] = [],
): string[] {
  const referenced = collectReferencedCharacters(storyboard);
  if (referenced.length === 0) {
    return [];
  }

  const profileMap = new Map<string, CharacterProfile>();
  for (const profile of profiles) {
    profileMap.set(profile.id.toLowerCase(), profile);
    profileMap.set(profile.name.toLowerCase(), profile);
  }

  const lines: string[] = [];
  lines.push('## Character Bindings');
  lines.push('');
  lines.push('| Character | Go Bananas ID | Reference Assets |');
  lines.push('|---|---:|---|');
  for (const name of referenced) {
    const profile = profileMap.get(name.toLowerCase());
    const referenceAssets = profile?.referenceAssets?.length
      ? profile.referenceAssets.join(', ')
      : '(none)';
    lines.push(`| ${name} | ${profile?.goBananasId ?? '—'} | ${referenceAssets} |`);
  }
  lines.push('');
  return lines;
}

export function storyboardMarkdownPathFor(projectSlug: string, root = process.cwd()): string {
  const workspace = resolveProjectWorkspace(projectSlug, root);
  return join(workspace.projectDir, 'storyboard.md');
}

export function isStoryboardApproved(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.VIDEOCLAW_APPROVE_STORYBOARD?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

function buildStoryboardReviewCommand(projectSlug: string, root: string): string {
  return [
    'vclaw',
    'video',
    'storyboard-review',
    '--project',
    shellQuote(projectSlug),
    '--root',
    shellQuote(root),
    '--mode',
    'director',
  ].join(' ');
}

function buildStoryboardApprovalCommand(projectSlug: string, root: string): string {
  return [
    'VIDEOCLAW_APPROVE_STORYBOARD=1',
    'vclaw',
    'video',
    'execute',
    '--project',
    shellQuote(projectSlug),
    '--root',
    shellQuote(root),
    '--mode',
    'director',
  ].join(' ');
}

function buildVerifyEnvCommand(root: string): string {
  return [
    'vclaw',
    'video',
    'verify-env',
    '--root',
    shellQuote(root),
  ].join(' ');
}

export function buildStoryboardMarkdown(input: {
  projectSlug: string;
  root?: string;
  brief: BriefArtifactForMarkdown;
  storyboard: StoryboardArtifactForMarkdown;
  characterProfiles?: CharacterProfile[];
  executionPlan: Pick<VideoExecutionPlan, 'executionProfile' | 'promptGuidance' | 'recommendedRouteId'>;
  costEstimate?: VideoCostEstimate;
  preflight?: DirectorPreflightResult;
  referenceSheets?: ReferenceSheetsArtifact;
  sceneCandidates?: SceneCandidatesArtifact;
  sceneSelection?: SceneSelectionArtifact;
  generatedAt?: string;
}): string {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const root = input.root ?? process.cwd();
  const lines: string[] = [];
  const runtimeSeconds = input.storyboard.scenes.reduce(
    (sum, scene) => sum + (scene.durationSeconds ?? 0),
    0,
  );

  lines.push(`# Storyboard Review - ${input.brief.title}`);
  lines.push('');
  lines.push(`Project: \`${input.projectSlug}\``);
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');
  lines.push('Review this storyboard before running director-mode execution.');
  lines.push('');
  lines.push('## Intent');
  lines.push('');
  lines.push('```');
  lines.push(input.brief.intent);
  lines.push('```');
  lines.push('');
  lines.push('## Production Settings');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Production mode | \`${input.storyboard.productionMode}\` |`);
  lines.push(`| Genre | ${input.brief.metadata?.genre ?? '(none)'} |`);
  lines.push(`| Platform | ${input.brief.metadata?.platform ?? '(none)'} |`);
  lines.push(`| Style | ${input.brief.metadata?.style ?? '(none)'} |`);
  lines.push(`| Color grading | ${input.brief.metadata?.colorGrading ?? '(none)'} |`);
  lines.push(`| Recommended route | ${input.executionPlan.recommendedRouteId ?? '(none)'} |`);
  lines.push(`| Aspect ratio | ${input.executionPlan.executionProfile.aspectRatio} |`);
  lines.push(`| Quality | ${input.executionPlan.executionProfile.quality} |`);
  lines.push(`| Resolution | ${input.executionPlan.executionProfile.resolution} |`);
  lines.push(`| Audio | ${input.executionPlan.executionProfile.generateAudio ? 'on' : 'off'} |`);
  lines.push(`| Outputs | ${input.executionPlan.executionProfile.outputCount} |`);
  lines.push(`| Target runtime | ${input.brief.metadata?.targetRuntimeSeconds ? `${input.brief.metadata.targetRuntimeSeconds}s` : '(none)'} |`);
  lines.push(`| Runtime | ${runtimeSeconds > 0 ? `${runtimeSeconds}s` : 'unspecified'} |`);
  lines.push('');

  if (input.costEstimate) {
    lines.push('## Cost Estimate');
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|---|---|');
    lines.push(`| Scenes | ${input.costEstimate.sceneCount} |`);
    lines.push(`| Clip duration | ${input.costEstimate.clipDurationSeconds}s |`);
    lines.push(`| New characters | ${input.costEstimate.newCharacterCount} |`);
    lines.push(`| Narration | ${input.costEstimate.narrationEnabled ? 'on' : 'off'} |`);
    lines.push(`| Seedance | $${input.costEstimate.seedancePerSceneUsd.toFixed(2)} x ${input.costEstimate.sceneCount} = $${input.costEstimate.seedanceTotalUsd.toFixed(2)} |`);
    lines.push(`| Gemini | $${input.costEstimate.geminiTotalUsd.toFixed(2)} |`);
    lines.push(`| Go Bananas | $${input.costEstimate.goBananasTotalUsd.toFixed(2)} |`);
    lines.push(`| ElevenLabs | $${input.costEstimate.elevenLabsTotalUsd.toFixed(2)} |`);
    lines.push(`| Total | $${input.costEstimate.totalUsd.toFixed(2)} |`);
    lines.push(`| Estimated wall time | ~${input.costEstimate.wallTimeMinutes} min |`);
    lines.push('');
  }

  lines.push(...buildCharacterBindingLines(input.storyboard, input.characterProfiles));
  lines.push(...buildReferenceSheetsSectionLines(input.storyboard, input.referenceSheets));
  lines.push(
    ...buildCandidatesSectionLines(
      input.storyboard,
      input.sceneCandidates,
      input.sceneSelection,
    ),
  );
  lines.push('## Scenes');
  lines.push('');

  for (const scene of input.storyboard.scenes) {
    lines.push(`### Scene ${scene.sceneIndex + 1}`);
    lines.push('');
    lines.push(scene.description);
    lines.push('');
    if (scene.scenePrompt) {
      lines.push('Prompt split:');
      lines.push('');
      if (scene.scenePrompt.imagePrompt) {
        lines.push(`- Image prompt: ${scene.scenePrompt.imagePrompt}`);
      }
      if (scene.scenePrompt.animationPrompt) {
        lines.push(`- Animation prompt: ${scene.scenePrompt.animationPrompt}`);
      }
      if (scene.scenePrompt.cameraMove) {
        lines.push(`- Camera move: ${scene.scenePrompt.cameraMove}`);
      }
      if (scene.scenePrompt.styleFooter) {
        lines.push(`- Style footer: ${scene.scenePrompt.styleFooter}`);
      }
      lines.push('');
    }
    if (scene.characters && scene.characters.length > 0) {
      lines.push(`Characters: ${scene.characters.join(', ')}`);
      lines.push('');
    }
    if (scene.dialogue) {
      lines.push(`Dialogue: ${scene.dialogue}`);
      lines.push('');
    }
    if (scene.durationSeconds !== undefined) {
      lines.push(`Duration: ${scene.durationSeconds}s`);
      lines.push('');
    }
  }

  if (input.executionPlan.promptGuidance.length > 0) {
    lines.push('## Prompt Guidance');
    lines.push('');
    for (const entry of input.executionPlan.promptGuidance) {
      lines.push(`- ${entry.name}: ${entry.reason}`);
    }
    lines.push('');
  }

  if (input.preflight) {
    lines.push('## Preflight');
    lines.push('');
    lines.push(`Pass: ${input.preflight.pass ? 'yes' : 'no'}`);
    lines.push('');
    if (input.preflight.errors.length > 0) {
      lines.push('### Errors');
      lines.push('');
      for (const issue of input.preflight.errors) {
        lines.push(`- [${issue.code}] ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
      }
      lines.push('');
    }
    if (input.preflight.warnings.length > 0) {
      lines.push('### Warnings');
      lines.push('');
      for (const issue of input.preflight.warnings) {
        lines.push(`- [${issue.code}] ${issue.message}${issue.suggestion ? ` Suggestion: ${issue.suggestion}` : ''}`);
      }
      lines.push('');
    }
  }

  lines.push('## Approval');
  lines.push('');
  lines.push('Before approval, optionally sanity-check the runtime lane:');
  lines.push('');
  lines.push('```bash');
  lines.push(buildVerifyEnvCommand(root));
  lines.push('```');
  lines.push('');
  lines.push('If this storyboard is correct, run the approval command below:');
  lines.push('');
  lines.push('```bash');
  lines.push(buildStoryboardApprovalCommand(input.projectSlug, root));
  lines.push('```');
  lines.push('');
  lines.push('If the storyboard needs changes, refresh the review after adjusting the brief/storyboard artifacts:');
  lines.push('');
  lines.push('```bash');
  lines.push(buildStoryboardReviewCommand(input.projectSlug, root));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

export async function writeStoryboardMarkdownReview(input: {
  projectSlug: string;
  root?: string;
  executionPlan: Pick<VideoExecutionPlan, 'executionProfile' | 'promptGuidance' | 'recommendedRouteId'>;
  costEstimate?: VideoCostEstimate;
  preflight?: DirectorPreflightResult;
  generatedAt?: string;
}): Promise<{ markdownPath: string; markdown: string }> {
  const root = input.root ?? process.cwd();
  const workspace = resolveProjectWorkspace(input.projectSlug, root);
  const briefPath = artifactPathFor(workspace, 'brief');
  const storyboardPath = artifactPathFor(workspace, 'storyboard');
  const brief = JSON.parse(await readFile(briefPath, 'utf-8')) as BriefArtifactForMarkdown;
  const storyboard = JSON.parse(await readFile(storyboardPath, 'utf-8')) as StoryboardArtifactForMarkdown;
  const characterProfiles = await listCharacterProfiles(workspace);
  const referenceSheets = await readReferenceSheetsArtifact(workspace.root, input.projectSlug);
  const sceneCandidates = await readSceneCandidatesArtifact(workspace.root, input.projectSlug);
  const sceneSelection = await readSceneSelectionArtifact(workspace.root, input.projectSlug);
  const markdown = buildStoryboardMarkdown({
    projectSlug: input.projectSlug,
    root,
    brief,
    storyboard,
    characterProfiles,
    executionPlan: input.executionPlan,
    costEstimate: input.costEstimate,
    preflight: input.preflight,
    referenceSheets,
    sceneCandidates,
    sceneSelection,
    generatedAt: input.generatedAt,
  });
  const markdownPath = storyboardMarkdownPathFor(input.projectSlug, root);
  await writeFile(markdownPath, `${markdown}\n`);
  return { markdownPath, markdown };
}
