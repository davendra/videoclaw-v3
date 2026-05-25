#!/usr/bin/env node
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { buildProviderStatusReport } from '../video/provider-status.js';
import { createAnalyzeOutput } from '../video/analyze-output.js';
import { artifactPathFor, writeArtifact } from '../video/artifact-store.js';
import { buildArtifactHistoryReport } from '../video/artifact-history.js';
import { appendProjectEvent } from '../video/events.js';
import { addCharacterProfile, listCharacterProfiles, readCharacterProfile } from '../video/characters.js';
import { buildCharacterConsistencyReport } from '../video/character-consistency.js';
import { autoFixDirectorStoryboardContent, runDirectorPreflight } from '../video/director-preflight.js';
import { generateAnalyzeOutputWithGemini } from '../video/gemini-analyze.js';
import { listPlaybooks, readPlaybook } from '../video/playbooks.js';
import { listPromptReferences, readPromptReference } from '../video/prompt-library.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { writeStageCheckpoint } from '../video/checkpoints.js';
import { buildProjectStatusReport } from '../video/status.js';
import { writeStoryboardMarkdownReview } from '../video/storyboard-markdown.js';
import { doctorProject } from '../video/doctor.js';
import { doctorPortfolio } from '../video/doctor-portfolio.js';
import { importLegacyProjects } from '../video/legacy-import.js';
import { listProjects, isProjectSlug } from '../video/projects.js';
import { exitWith, writeOutput } from '../video/cli-output.js';
import { VclawError } from '../video/errors.js';

const RESERVED_SLUG_NAMES = new Set([
  'history',
  'artifacts',
  'checkpoints',
  'events',
  'state',
  'outputs',
  'assets',
  'obsidian',
  'characters',
  'notes',
  'tmp',
]);

function validateInitSlug(value: string): void {
  if (value.length < 3 || value.length > 64) {
    throw new VclawError(
      'invalid_slug',
      `video init: slug must be 3-64 chars (got ${value.length}): ${JSON.stringify(value)}`,
      { slug: value, reason: 'length' },
    );
  }
  if (value.startsWith('-')) {
    throw new VclawError(
      'invalid_slug',
      `video init: slug cannot start with '-' (looks like a CLI flag): ${JSON.stringify(value)}. ` +
      `If you meant to pass --project as a flag value, that's the argv-as-slug bug — run \`vclaw video init <real-slug>\` instead.`,
      { slug: value, reason: 'leading-hyphen' },
    );
  }
  if (!isProjectSlug(value)) {
    throw new VclawError(
      'invalid_slug',
      `video init: slug must match /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/ (got ${JSON.stringify(value)}). ` +
      `Lowercase letters, digits, and single hyphens only; must start and end with [a-z0-9].`,
      { slug: value, reason: 'pattern' },
    );
  }
  if (RESERVED_SLUG_NAMES.has(value)) {
    throw new VclawError(
      'invalid_slug',
      `video init: slug ${JSON.stringify(value)} is a reserved per-project directory name. ` +
      `Reserved: ${[...RESERVED_SLUG_NAMES].sort().join(', ')}.`,
      { slug: value, reason: 'reserved' },
    );
  }
  if (value.includes('--')) {
    throw new VclawError(
      'invalid_slug',
      `video init: slug cannot contain consecutive hyphens '--' (got ${JSON.stringify(value)}).`,
      { slug: value, reason: 'double-hyphen' },
    );
  }
}
import { exportProjectToObsidian } from '../video/obsidian-export.js';
import { buildProjectIndex, writeProjectIndex } from '../video/project-index.js';
import { buildPortfolioMetrics } from '../video/metrics.js';
import { buildNextActions } from '../video/next-actions.js';
import { buildDependencyReport } from '../video/dependencies.js';
import { buildOwnerWorkloadReport } from '../video/workload.js';
import { LIBRARY_HELP, findLibraryCharactersByIntent, parseLibraryCleanArgs, runLibraryClean } from '../video/library-clean.js';
import { appendVideoContextChangelog } from '../video/video-context.js';
import { buildClonePlan, buildStoryboardFromClonePlan, listTemplates, readTemplate, saveTemplateFromAnalyzeOutput, validateTemplate } from '../video/template-store.js';
import { buildStoryboardScenesFromTemplate, listStoryboardTemplates, readStoryboardTemplate } from '../video/storyboard-templates.js';
import { launchReviewUi, runReviewAutopilot } from '../video/review-ui.js';
import { buildProjectReadiness } from '../video/readiness.js';
import { parseExecutionProfileInput, setExecutionProfileOverrides } from '../video/execution-profile.js';
import { buildExecutionPlan } from '../video/execution-plan.js';
import { scaffoldExecutionSeedAssetsFromStoryboard } from '../video/execution-seed.js';
import { executeProject } from '../video/execute.js';
import { cancelExecution } from '../video/execution-cancel.js';
import { refreshExecutionStatus } from '../video/execution-status.js';
import { buildPortfolioReport } from '../video/report.js';
import { exportPortfolioCsv } from '../video/csv-export.js';
import { recordStoryboardStillCandidate } from '../video/storyboard-still-candidates.js';
import {
  buildPortfolioTrendReport,
  listPortfolioReportSnapshots,
  writePortfolioReportSnapshot,
} from '../video/report-history.js';
import { buildPortfolioReportDiff } from '../video/report-diff.js';
import { syncObsidianVault } from '../video/obsidian-sync.js';
import { scaffoldObsidianVault } from '../video/obsidian-vault.js';
import { assertStageReady } from '../video/stage-guards.js';
import { parseClipDurationSeconds, resolveDirectorCreateDefaults } from '../video/director-defaults.js';
import { buildProjectCostEstimate, buildVideoCostEstimate } from '../video/cost-estimate.js';
import { buildVideoEnvironmentReport } from '../video/verify-env.js';
import { remixNarratedProject } from '../video/remix-narrated.js';
import { verifyFinalOutput } from '../video/verify-final.js';
import { archiveProject } from '../video/archive-project.js';
import { burnVideoSubtitles, createVideoThumbnail, makeVideoVariant } from '../video/post-production.js';
import { autoCreateCharacters } from '../video/character-auto-create.js';
import {
  readReferenceSheetsArtifact,
  writeReferenceSheetsArtifact,
} from '../video/reference-sheet-store.js';
import {
  readSceneCandidatesArtifact,
} from '../video/scene-candidate-store.js';
import {
  readSceneSelectionArtifact,
  writeSceneSelectionArtifact,
} from '../video/scene-selection-store.js';
import {
  candidatesForScene,
  deriveAssetManifestFromSelection,
  findCandidate,
  summarizeCandidates,
} from '../video/scene-candidates.js';
import {
  rejectCandidate,
  requestReroll,
  selectCandidate,
  setChainFromPrev,
} from '../video/scene-selection.js';
import { migrateCandidatesFromAssetManifest } from '../video/candidate-migrate.js';
import {
  addReferenceToSheet,
  bindSheetToScenes,
  createSheet,
  findRoleCollisions,
  findSheet,
  isRoleValidForType,
  summarizeArtifact,
  upsertSheet,
  validateArtifact,
  REFERENCE_SHEET_TYPES,
  ROLE_VOCABULARY,
} from '../video/reference-sheets.js';
import type { GbRefKind, ReferenceRole, ReferenceSheetType } from '../video/types.js';
import { ensureProjectWorkspace, readProjectManifest, updateProjectManifestMetadata, updateProjectManifestState, writeProjectManifest } from '../video/workspace.js';
import {
  createBriefArtifact,
  createPublishReportArtifact,
  createReviewReportArtifact,
  createStoryboardArtifact,
} from '../video/artifacts.js';
import type { VideoAnalyzeOutput, VideoProductionMode } from '../video/types.js';

function runningAsOmxAlias(): boolean {
  return basename(process.argv[1] ?? '') === 'omx.js';
}

function printCompatibilityNotice(): void {
  if (!runningAsOmxAlias()) return;
  process.stderr.write('[deprecation] `omx` is a temporary compatibility alias. Prefer `vclaw`.\n');
}

function printHelp(): void {
  process.stdout.write(`vclaw - video-first clean-room core\n\nUsage:\n  vclaw video providers [--workspace-root <path>]\n  vclaw video verify-env [--root <path>] [--workspace-root <path>]\n  vclaw video init <slug> [--root <path>] [--mode storyboard|director]\n  vclaw video create "<intent>" [--project <slug>] [--root <path>] [--production-mode storyboard|director] [--title <title>] [--genre <genre-id>] [--runtime MM:SS|seconds] [--scenes <count>] [--clip-duration <seconds>] [--style <preset>] [--color-grading <preset>] [--platform <name>] [--gb-character <Name:ID> ...] [--import-library-characters] [--auto-create-characters <json-path>] [--api-url <url>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4] [--apply-content-fixes] [--execute] [--dry-run]\n  vclaw video auto "<intent>" [--project <slug>] [--root <path>] [--title <title>] [--genre <genre-id>] [--runtime MM:SS|seconds] [--scenes <count>] [--clip-duration <seconds>] [--style <preset>] [--color-grading <preset>] [--platform <name>] [--gb-character <Name:ID> ...] [--import-library-characters] [--auto-create-characters <json-path>] [--api-url <url>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4] [--apply-content-fixes] [--execute] [--dry-run]\n  vclaw video iterate "<intent>" [--project <slug>] [--root <path>] [--title <title>] [--genre <genre-id>] [--runtime MM:SS|seconds] [--scenes <count>] [--clip-duration <seconds>] [--style <preset>] [--color-grading <preset>] [--platform <name>] [--gb-character <Name:ID> ...] [--import-library-characters] [--auto-create-characters <json-path>] [--api-url <url>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4] [--apply-content-fixes]\n  vclaw video run-pipeline "<intent>" [--project <slug>] [--root <path>] [--title <title>] [--genre <genre-id>] [--runtime MM:SS|seconds] [--scenes <count>] [--clip-duration <seconds>] [--style <preset>] [--color-grading <preset>] [--platform <name>] [--gb-character <Name:ID> ...] [--import-library-characters] [--auto-create-characters <json-path>] [--api-url <url>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4] [--apply-content-fixes] [--dry-run]\n  vclaw video approve --project <slug> [--root <path>] [--mode storyboard|director] [--dry-run]\n  vclaw video cost-estimate [--project <slug>] [--root <path>] [--scenes <count>] [--clip-duration <seconds>] [--new-characters <count>] [--narration on|off]\n  vclaw video remix-narrated --project <slug> [--root <path>] [--output <path>]\n  vclaw video verify-final (--project <slug> | --file <path>) [--root <path>] [--output-dir <path>]\n  vclaw video make-vertical (--project <slug> | --file <path>) [--root <path>] [--output <path>]\n  vclaw video make-square (--project <slug> | --file <path>) [--root <path>] [--output <path>]\n  vclaw video make-loop (--project <slug> | --file <path>) [--root <path>] [--output <path>]\n  vclaw video thumbnail (--project <slug> | --file <path>) [--root <path>] [--output <path>] [--text <title>]\n  vclaw video archive-project --project <slug> [--root <path>] [--archive-dir <path>] [--cleanup]\n  vclaw video find-library --intent "<text>" [--api-url <url>]\n  vclaw video list-library [--name-regex <pattern>] [--root <path>]\n  vclaw video import-legacy --source <path> [--root <path>]\n  vclaw video set-meta --project <slug> [--root <path>] [--owner <name>] [--priority low|medium|high|critical] [--due YYYY-MM-DD] [--tag <value> ...] [--blocked-by <slug> ...] [--blocked-reason <text>]\n  vclaw video set-execution-profile --project <slug> [--root <path>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4]\n  vclaw video character-add --project <slug> --name <name> [--gb-id <id>] [--description <text>] [--ref <path> ...] [--note <text> ...] [--root <path>]\n  vclaw video character-auto-create --project <slug> --input <json-path> [--root <path>] [--api-url <url>] [--dry-run]\n  vclaw video character-import-library --project <slug> --intent "<text>" [--root <path>] [--api-url <url>]\n  vclaw video character-list --project <slug> [--root <path>]\n  vclaw video character-show --project <slug> --name <name> [--root <path>]\n  vclaw video character-consistency --project <slug> [--root <path>]\n  vclaw video storyboard-review --project <slug> [--root <path>] [--mode storyboard|director] [--apply-content-fixes]\n  vclaw video director-preflight --project <slug> [--root <path>] [--apply-content-fixes]\n  vclaw video library find --intent "<text>" [--api-url <url>]\n  vclaw video library clean [options]\n  vclaw video playbook-list [--root <path>]\n  vclaw video playbook-show --name <playbook-name> [--root <path>]\n  vclaw video prompt-lib-list\n  vclaw video prompt-lib-show --name <reference-name> [--root <path>]\n  vclaw video analyze-template --project <slug> --source <path-or-url> [options] [--auto]\n  vclaw video template-create --project <slug> --name <template-name> [--root <path>]\n  vclaw video template-save --project <slug> --name <template-name> [--root <path>]\n  vclaw video template-list [--root <path>]\n  vclaw video template-show --name <template-name> [--root <path>]\n  vclaw video template-validate --name <template-name> [--root <path>]\n  vclaw video storyboard-template-list\n  vclaw video storyboard-template-show --name <template-id>\n  vclaw video clone-ad --template <template-name> --project <slug> --intent <text> [--root <path>] [--mode storyboard|director] [--platform <name>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4] [--dry-run]\n  vclaw video clone-plan --template <template-name> --project <slug> --intent <text> [--root <path>]\n  vclaw video clone-init --template <template-name> --project <slug> --intent <text> [--root <path>] [--mode storyboard|director] [--platform <name>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4]\n  vclaw video storyboard-from-clone --project <slug> [--root <path>] [--mode storyboard|director]\n  vclaw video clone-execute --template <template-name> --project <slug> --intent <text> [--root <path>] [--mode storyboard|director] [--platform <name>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4] [--dry-run]\n  vclaw video readiness --project <slug> [--root <path>] [--mode storyboard|director]\n  vclaw video plan --project <slug> [--root <path>] [--mode storyboard|director]\n  vclaw video execution-plan --project <slug> [--root <path>] [--mode storyboard|director]\n  vclaw video produce --project <slug> [--root <path>] [--mode storyboard|director] [--dry-run] [--scene <sceneIndex> ...]\n  vclaw video execute --project <slug> [--root <path>] [--mode storyboard|director] [--dry-run] [--scene <sceneIndex> ...]\n  vclaw video execute-status --project <slug> [--root <path>] [--mode storyboard|director]\n  vclaw video list [--root <path>]\n  vclaw video index [--root <path>] [--output <path>]\n  vclaw video metrics [--root <path>] [--mode storyboard|director]\n  vclaw video workload [--root <path>] [--mode storyboard|director]\n  vclaw video next-actions [--root <path>] [--mode storyboard|director]\n  vclaw video dependencies [--root <path>] [--mode storyboard|director]\n  vclaw video report [--root <path>] [--mode storyboard|director]\n  vclaw video report-snapshot [--root <path>] [--mode storyboard|director]\n  vclaw video report-history [--root <path>]\n  vclaw video report-diff [--root <path>] [--from <snapshot-path>] [--to <snapshot-path>]\n  vclaw video trends [--root <path>]\n  vclaw video export-csv [--root <path>] [--output-dir <path>] [--mode storyboard|director]\n  vclaw video status --project <slug> [--root <path>] [--mode storyboard|director]\n  vclaw video doctor-project --project <slug> [--root <path>] [--mode storyboard|director]\n  vclaw video doctor-portfolio [--root <path>] [--mode storyboard|director]\n  vclaw video artifact-history --project <slug> --artifact <name> [--root <path>]\n  vclaw video export-obsidian --project <slug> [--root <path>] [--output-dir <path>] [--mode storyboard|director]\n  vclaw video scaffold-obsidian-vault [--output-dir <path>]\n  vclaw video sync-obsidian [--root <path>] [--output-dir <path>] [--mode storyboard|director]\n  vclaw video brief --project <slug> --title <title> --intent <intent> [--root <path>] [--mode storyboard|director] [--platform <name>] [--aspect-ratio 16:9|9:16|1:1] [--quality fast|quality] [--resolution 720p|1080p] [--audio on|off] [--outputs 1-4]\n  vclaw video storyboard --project <slug> (--scene <text> [--scene <text> ...] | --template <template-id> [--environment <text>] [--character-a <name>] [--character-b <name>]) [--scene-character <sceneIndex:name> ...] [--root <path>] [--mode storyboard|director]\n  vclaw video assets --project <slug> --asset <kind:path[:sceneIndex][:backend]> [--asset ...] [--root <path>]\n  vclaw video review --project <slug> --verdict pass|retry|fail [--finding <text> ...] [--root <path>]\n  vclaw video publish --project <slug> --status ready|published|blocked [--final-output <path>] [--note <text> ...] [--root <path>]\n  vclaw video analyze --project <slug> --source <path-or-url> [options] [--auto]\n`);
  process.stdout.write('  vclaw video execute-cancel --project <slug> [--root <path>] [--mode storyboard|director]\n');
  process.stdout.write('  vclaw video review-ui --project <slug> [--root <path>] [--host <host>] [--port <port>] [--ui-path <path>] [--dry-run]\n');
  process.stdout.write('  vclaw video review-autopilot --project <slug> [--root <path>] [--template <template-id>] [--character <name>] [--run-id <id>]\n');
  process.stdout.write('  vclaw video burn-subtitles (--project <slug> | --file <path>) --subtitle <path> [--root <path>] [--output <path>]\n');
  process.stdout.write('  vclaw video reference-sheet-add --project <slug> --type <type> --name <name> [--id <id>] [--description <text>] [--character-name <name>] [--ref <path>:<role>[:<note>] ...] [--gb-ref <kind>:<id>:<role>[:<note>] ...] [--binding <sceneIndex> ...] [--root <path>]\n');
  process.stdout.write('  vclaw video reference-sheet-list --project <slug> [--type <sheet-type>] [--root <path>]\n');
  process.stdout.write('  vclaw video reference-sheet-show --project <slug> --id <sheet-id> [--root <path>]\n');
  process.stdout.write('  vclaw video reference-sheet-bind --project <slug> --id <sheet-id> --scene <sceneIndex> [--scene <sceneIndex> ...] [--root <path>]\n');
  process.stdout.write('  vclaw video reference-sheet-validate --project <slug> [--root <path>]\n');
  process.stdout.write('  vclaw video candidates-list --project <slug> [--scene <sceneIndex>] [--root <path>]\n');
  process.stdout.write('  vclaw video candidates-show --project <slug> --candidate-id <id> [--root <path>]\n');
  process.stdout.write('  vclaw video storyboard-still-add --project <slug> --scene <sceneIndex> --image-url <url> [--image-id <id>] [--prompt <text>] [--notes <text>] [--root <path>]\n');
  process.stdout.write('  vclaw video select-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>] [--root <path>]\n');
  process.stdout.write('  vclaw video reject-candidate --project <slug> --scene <sceneIndex> --candidate-id <id> [--notes <text>] [--root <path>]\n');
  process.stdout.write('  vclaw video reroll-scene --project <slug> --scene <sceneIndex> [--chain-from-prev on|off] [--root <path>]\n');
  process.stdout.write('  vclaw video chain-from --project <slug> --scene <sceneIndex> --from <sourceSceneIndex> [--root <path>]\n');
  process.stdout.write('    v1 supports chain-from-prev only: --from must equal --scene - 1.\n');
  process.stdout.write('  vclaw video unchain --project <slug> --scene <sceneIndex> [--root <path>]\n');
  process.stdout.write('  vclaw video candidates-migrate-from-assets --project <slug> [--dry-run] [--root <path>]\n');
}

async function handleVideoRemixNarrated(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video remix-narrated requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const outputPath = parseFlagValue(args, '--output') ?? undefined;
  const result = await remixNarratedProject(projectSlug, {
    root,
    ...(outputPath ? { outputPath } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoListLibrary(args: string[]): Promise<void> {
  const nameRegex = parseFlagValue(args, '--name-regex') ?? '.';
  const baseArgs = ['--dry-run', '--name-regex', nameRegex];
  const apiUrl = parseFlagValue(args, '--api-url');
  if (apiUrl) {
    baseArgs.push('--api-url', apiUrl);
  }
  const exitCode = await runLibraryClean(parseLibraryCleanArgs(baseArgs));
  process.exit(exitCode);
}

async function handleVideoFindLibrary(args: string[]): Promise<void> {
  const intent = parseFlagValue(args, '--intent');
  if (!intent) {
    throw new Error('video find-library requires --intent <text>');
  }
  const apiKey = process.env.GO_BANANAS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GO_BANANAS_API_KEY is required for video find-library');
  }
  const apiUrl = parseFlagValue(args, '--api-url') ?? process.env.GO_BANANAS_API_URL ?? 'https://gobananasai.com/api';
  const characters = await findLibraryCharactersByIntent(intent, apiKey, apiUrl);
  process.stdout.write(`${JSON.stringify({ intent, apiUrl, characters }, null, 2)}\n`);
}

async function handleVideoVerifyFinal(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project') ?? undefined;
  const filePath = parseFlagValue(args, '--file') ?? undefined;
  if (!projectSlug && !filePath) {
    throw new Error('video verify-final requires either --project <slug> or --file <path>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const outputDir = parseFlagValue(args, '--output-dir') ?? undefined;
  const result = await verifyFinalOutput({
    ...(projectSlug ? { projectSlug } : {}),
    ...(filePath ? { filePath } : {}),
    root,
    ...(outputDir ? { outputDir } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoMakeVertical(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project') ?? undefined;
  const filePath = parseFlagValue(args, '--file') ?? undefined;
  if (!projectSlug && !filePath) {
    throw new Error('video make-vertical requires either --project <slug> or --file <path>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const outputPath = parseFlagValue(args, '--output') ?? undefined;
  const result = await makeVideoVariant({
    projectSlug,
    filePath,
    root,
    outputPath,
    variant: 'vertical',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoMakeSquare(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project') ?? undefined;
  const filePath = parseFlagValue(args, '--file') ?? undefined;
  if (!projectSlug && !filePath) {
    throw new Error('video make-square requires either --project <slug> or --file <path>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const outputPath = parseFlagValue(args, '--output') ?? undefined;
  const result = await makeVideoVariant({
    projectSlug,
    filePath,
    root,
    outputPath,
    variant: 'square',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoMakeLoop(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project') ?? undefined;
  const filePath = parseFlagValue(args, '--file') ?? undefined;
  if (!projectSlug && !filePath) {
    throw new Error('video make-loop requires either --project <slug> or --file <path>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const outputPath = parseFlagValue(args, '--output') ?? undefined;
  const result = await makeVideoVariant({
    projectSlug,
    filePath,
    root,
    outputPath,
    variant: 'loop',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoThumbnail(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project') ?? undefined;
  const filePath = parseFlagValue(args, '--file') ?? undefined;
  if (!projectSlug && !filePath) {
    throw new Error('video thumbnail requires either --project <slug> or --file <path>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const outputPath = parseFlagValue(args, '--output') ?? undefined;
  const text = parseFlagValue(args, '--text') ?? undefined;
  const result = await createVideoThumbnail({
    projectSlug,
    filePath,
    root,
    outputPath,
    ...(text ? { text } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoBurnSubtitles(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project') ?? undefined;
  const filePath = parseFlagValue(args, '--file') ?? undefined;
  if (!projectSlug && !filePath) {
    throw new Error('video burn-subtitles requires either --project <slug> or --file <path>');
  }
  const subtitlePath = parseFlagValue(args, '--subtitle') ?? undefined;
  if (!subtitlePath) {
    throw new Error('video burn-subtitles requires --subtitle <path>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const outputPath = parseFlagValue(args, '--output') ?? undefined;
  const result = await burnVideoSubtitles({
    projectSlug,
    filePath,
    root,
    subtitlePath,
    outputPath,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

function parseRepeatableFlag(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      values.push(args[index + 1] ?? '');
    }
  }
  return values.filter(Boolean);
}

function slugifyProject(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function deriveCreateTitle(intent: string): string {
  const normalized = intent
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["']|["']$/g, '');
  if (!normalized) return 'Untitled Video';
  if (normalized.length <= 72) return normalized;
  return `${normalized.slice(0, 69).trimEnd()}...`;
}

function deriveCreateSlug(args: string[], intent: string): string {
  const explicit = parseFlagValue(args, '--project') ?? parseFlagValue(args, '--slug');
  if (explicit) return explicit;
  const title = parseFlagValue(args, '--title') ?? deriveCreateTitle(intent);
  const slug = slugifyProject(title);
  if (!slug) {
    throw new Error('Could not derive a project slug from the create intent. Pass --project <slug>.');
  }
  return slug;
}

async function ensureProjectInitialized(
  slug: string,
  root: string,
  mode: VideoProductionMode,
): Promise<Awaited<ReturnType<typeof ensureProjectWorkspace>>> {
  const workspace = await ensureProjectWorkspace(slug, root);
  const existingManifest = await readProjectManifest(workspace);
  if (!existingManifest) {
    const pipeline = getBuiltinPipelineManifest(mode);
    const now = new Date().toISOString();
    await writeProjectManifest(workspace, {
      slug,
      productionMode: mode,
      createdAt: now,
      updatedAt: now,
      pipeline,
      currentStage: 'brief',
      lastCompletedStage: null,
      lastCheckpointStatus: 'pending',
    });
    await writeStageCheckpoint(workspace, {
      stage: 'brief',
      status: 'pending',
      generatedAt: now,
      artifacts: {},
      summary: 'Project initialized; brief not yet created.',
      issues: [],
      nextAction: 'Create the brief artifact.',
    });
    await appendProjectEvent(workspace, {
      type: 'project.initialized',
      recordedAt: now,
      payload: { productionMode: mode, pipeline: pipeline.name },
    });
  }
  return workspace;
}

function parseGbCharacters(args: string[]): Array<{ name: string; goBananasId: number }> {
  return parseRepeatableFlag(args, '--gb-character').map((value) => {
    const separatorIndex = value.lastIndexOf(':');
    if (separatorIndex < 0) {
      throw new Error(`Invalid --gb-character value: "${value}". Expected Name:ID`);
    }
    const name = value.slice(0, separatorIndex).trim();
    const goBananasId = Number(value.slice(separatorIndex + 1));
    if (!name || !Number.isInteger(goBananasId) || goBananasId <= 0) {
      throw new Error(`Invalid --gb-character value: "${value}". Expected Name:ID`);
    }
    return { name, goBananasId };
  });
}

function mergeGbCharacters(
  ...groups: Array<Array<{ name: string; goBananasId: number; sourceNote?: string }>>
): Array<{ name: string; goBananasId: number; sourceNote?: string }> {
  const merged = new Map<string, { name: string; goBananasId: number; sourceNote?: string }>();
  for (const group of groups) {
    for (const entry of group) {
      const key = entry.name.trim().toLowerCase();
      if (!key) continue;
      merged.set(key, entry);
    }
  }
  return [...merged.values()];
}

function buildCreateStoryboardScenes(input: {
  intent: string;
  sceneCount: number;
  mode: VideoProductionMode;
  characterNames: string[];
  genre?: string;
  tone?: string;
  actStructure?: string[];
  style?: string;
  colorGrading?: string;
  durationSeconds?: number;
}): Array<{
  sceneIndex: number;
  description: string;
  characters?: string[];
  durationSeconds?: number;
}> {
  const describeBeatDirective = (beatLabel: string): string => {
    const normalized = beatLabel.toLowerCase();
    if (/(escape|chase|flight|departure|pursuit)/.test(normalized)) {
      return 'Break the geography open with pursuit, route changes, and visible momentum.';
    }
    if (/(choice|decision|agency|commitment)/.test(normalized)) {
      return 'Stage a decision point where risk, hesitation, and agency are visibly in tension.';
    }
    if (/(clash|crisis|showdown|confrontation)/.test(normalized)) {
      return 'Intensify the conflict with a sharper visual turn, but keep the action provider-safe.';
    }
    if (/(resolution|ending|aftermath|return)/.test(normalized)) {
      return 'Collapse the tension into a clear after-image that shows what changed.';
    }
    if (/(hook|opening|world-establish|establishing)/.test(normalized)) {
      return 'Anchor the world quickly with an image that makes the premise legible at a glance.';
    }
    return 'Change the visual logic enough that the next beat feels like a new piece of story.';
  };
  const styleNotes = [input.style, input.colorGrading].filter(Boolean).join(' + ');
  const actStructure = input.actStructure && input.actStructure.length > 0
    ? input.actStructure
    : [
        'opening image',
        'escalation',
        'proof beat',
        'payoff setup',
        'resolution',
      ];
  const pickSceneCharacters = (sceneIndex: number): string[] => {
    if (input.characterNames.length <= 1) return [...input.characterNames];
    if (sceneIndex === 0 || sceneIndex === input.sceneCount - 1) {
      return [...input.characterNames];
    }

    const focusIndex = (sceneIndex - 1) % input.characterNames.length;
    const focused = input.characterNames[focusIndex];
    const support = input.characterNames[(focusIndex + 1) % input.characterNames.length];
    if (!focused) return [...input.characterNames];
    if (input.characterNames.length === 2) {
      return [focused];
    }
    return sceneIndex % 2 === 0 ? [focused] : [focused, support].filter(Boolean) as string[];
  };

  return Array.from({ length: input.sceneCount }, (_, sceneIndex) => {
    const oneBased = sceneIndex + 1;
    const beatIndex = Math.min(
      Math.floor((sceneIndex / Math.max(input.sceneCount, 1)) * actStructure.length),
      actStructure.length - 1,
    );
    const beatLabel = actStructure[beatIndex] ?? actStructure[0] ?? 'story beat';
    const sceneCharacters = pickSceneCharacters(sceneIndex);
    const characterNames = sceneCharacters.length > 0 ? sceneCharacters.join(', ') : null;
    const beatNote = input.genre
      ? `${input.genre} beat: ${beatLabel}.`
      : `Beat focus: ${beatLabel}.`;
    const beatDirective = describeBeatDirective(beatLabel);
    const continuityNote = sceneIndex === 0
      ? `Translate the brief "${input.intent}" into an immediately legible opening image.`
      : sceneIndex === input.sceneCount - 1
        ? 'Resolve the previous movement into a final image that completes the sequence cleanly.'
        : `${beatDirective} Move beyond Scene ${sceneIndex} with a new reveal, geography change, or framing strategy.`;
    const castNote = characterNames
      ? (sceneIndex === 0
        ? `Bring ${characterNames} into frame decisively.`
        : sceneIndex === input.sceneCount - 1
          ? `Reunite ${characterNames} in the payoff image.`
          : `Center ${characterNames} in this transition.`)
      : '';
    const toneNote = input.tone
      ? (sceneIndex === 0
        ? `Set the emotional lane as ${input.tone}.`
        : sceneIndex === input.sceneCount - 1
          ? `Let the ending still feel ${input.tone}.`
          : '')
      : '';
    const styleNote = styleNotes
      ? (sceneIndex === 0
        ? `Stage the opening with ${styleNotes}.`
        : sceneIndex === input.sceneCount - 1
          ? `Close the sequence in ${styleNotes}.`
          : `Render this beat through ${styleNotes}.`)
      : '';
    return {
      sceneIndex,
      description: `Scene ${oneBased} of ${input.sceneCount}: ${beatNote} ${continuityNote} ${castNote} ${toneNote} ${styleNote}`.replace(/\s+/g, ' ').trim(),
      ...(sceneCharacters.length > 0 ? { characters: sceneCharacters } : {}),
      ...(input.mode === 'director' ? { durationSeconds: input.durationSeconds ?? 15 } : {}),
    };
  });
}

function parseExecutionProfileFlags(args: string[]): Record<string, unknown> {
  const audioRaw = parseFlagValue(args, '--audio');
  const profile = parseExecutionProfileInput({
    aspectRatio: parseFlagValue(args, '--aspect-ratio'),
    quality: parseFlagValue(args, '--quality'),
    resolution: parseFlagValue(args, '--resolution'),
    generateAudio: audioRaw === undefined ? undefined : audioRaw === 'on' ? true : audioRaw === 'off' ? false : undefined,
    outputCount: parseFlagValue(args, '--outputs') ? Number(parseFlagValue(args, '--outputs')) : undefined,
  });
  return Object.keys(profile).length > 0 ? profile : {};
}

function applyPlatformExecutionProfileDefaults(
  platform: string | undefined,
  profile: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = String(platform ?? '').trim().toLowerCase();
  if (!normalized) return profile;

  if (!profile.aspectRatio) {
    if (['tiktok', 'reels', 'shorts', 'instagram-reels', 'youtube-shorts'].includes(normalized)) {
      profile.aspectRatio = '9:16';
    } else if (['youtube', 'linkedin', 'web'].includes(normalized)) {
      profile.aspectRatio = '16:9';
    }
  }

  return profile;
}

function buildBriefEventPayload(input: {
  artifactPath: string;
  title: string;
  targetRuntimeSeconds?: number;
  clipDurationSeconds?: number;
  genre?: string;
  platform?: string;
  executionProfile?: Record<string, unknown>;
  source?: string;
}): Record<string, unknown> {
  return {
    artifactPath: input.artifactPath,
    title: input.title,
    ...(typeof input.targetRuntimeSeconds === 'number' ? { targetRuntimeSeconds: input.targetRuntimeSeconds } : {}),
    ...(typeof input.clipDurationSeconds === 'number' ? { clipDurationSeconds: input.clipDurationSeconds } : {}),
    ...(input.genre ? { genre: input.genre } : {}),
    ...(input.platform ? { platform: input.platform } : {}),
    ...(input.executionProfile && Object.keys(input.executionProfile).length > 0
      ? { executionProfile: input.executionProfile }
      : {}),
    ...(input.source ? { source: input.source } : {}),
  };
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

async function handleVideoCreate(args: string[]): Promise<void> {
  const intent = args.find((value) => !value.startsWith('--'))?.trim();
  if (!intent) {
    throw new Error('video create requires an intent string as the first positional argument');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--production-mode') ?? parseFlagValue(args, '--mode') ?? 'director') as VideoProductionMode;
  const title = parseFlagValue(args, '--title') ?? deriveCreateTitle(intent);
  const slug = deriveCreateSlug(args, intent);
  const sceneCountRaw = parseFlagValue(args, '--scenes');
  const applyContentFixes = args.includes('--apply-content-fixes');
  const execute = args.includes('--execute');
  const dryRun = args.includes('--dry-run');
  const explicitGbCharacters = parseGbCharacters(args).map((entry) => ({
    ...entry,
    sourceNote: 'Imported from `video create --gb-character`.',
  }));
  const importLibraryCharacters = args.includes('--import-library-characters');
  const autoCreateCharactersPath = parseFlagValue(args, '--auto-create-characters');
  const apiUrl = parseFlagValue(args, '--api-url') ?? process.env.GO_BANANAS_API_URL ?? 'https://gobananasai.com/api';

  const workspace = await ensureProjectInitialized(slug, root, mode);
  const existingBriefPath = artifactPathFor(workspace, 'brief');
  const existingBriefMetadata = existsSync(existingBriefPath)
    ? (JSON.parse(await readFile(existingBriefPath, 'utf-8')) as { metadata?: Record<string, unknown> }).metadata ?? {}
    : {};
  const preservedGenre = typeof existingBriefMetadata.genre === 'string' ? existingBriefMetadata.genre : undefined;
  const preservedPlatform = typeof existingBriefMetadata.platform === 'string' ? existingBriefMetadata.platform : undefined;
  const preservedStyle = typeof existingBriefMetadata.style === 'string' ? existingBriefMetadata.style : undefined;
  const preservedColorGrading = typeof existingBriefMetadata.colorGrading === 'string' ? existingBriefMetadata.colorGrading : undefined;
  const preservedClipDurationSeconds = typeof existingBriefMetadata.clipDurationSeconds === 'number'
    ? existingBriefMetadata.clipDurationSeconds
    : undefined;
  const clipDurationOverride = parseClipDurationSeconds(
    parseFlagValue(args, '--clip-duration')
      ?? process.env.SEEDANCE_CLIP_DURATION_SEC
      ?? (preservedClipDurationSeconds !== undefined ? String(preservedClipDurationSeconds) : undefined),
  );
  const genreDefaults = mode === 'director'
    ? resolveDirectorCreateDefaults({
        intent,
        explicitGenre: parseFlagValue(args, '--genre') ?? preservedGenre,
        explicitRuntime: parseFlagValue(args, '--runtime'),
        explicitClipDurationSeconds: clipDurationOverride,
        explicitSceneCount: sceneCountRaw ? Number(sceneCountRaw) : undefined,
        explicitPlatform: parseFlagValue(args, '--platform') ?? preservedPlatform,
        explicitStyle: parseFlagValue(args, '--style') ?? preservedStyle,
        explicitColorGrading: parseFlagValue(args, '--color-grading') ?? preservedColorGrading,
      })
    : null;
  const sceneCount = genreDefaults?.sceneCount ?? (sceneCountRaw ? Number(sceneCountRaw) : mode === 'director' ? 8 : 3);
  if (!Number.isInteger(sceneCount) || sceneCount <= 0) {
    throw new Error('video create requires --scenes to be a positive integer when provided');
  }
  const genre = genreDefaults?.genre;
  const style = genreDefaults?.style ?? parseFlagValue(args, '--style');
  const colorGrading = genreDefaults?.colorGrading ?? parseFlagValue(args, '--color-grading');
  const platform = genreDefaults?.platform ?? parseFlagValue(args, '--platform');
  const resolvedDefaults = mode === 'director'
    ? {
        ...(genre ? { genre } : {}),
        ...(platform ? { platform } : {}),
        ...(style ? { style } : {}),
        ...(colorGrading ? { colorGrading } : {}),
        ...(genreDefaults?.runtimeSeconds ? { targetRuntimeSeconds: genreDefaults.runtimeSeconds } : {}),
        ...(genreDefaults?.durationSeconds ? { clipDurationSeconds: genreDefaults.durationSeconds } : {}),
        sceneCount,
      }
    : null;
  const importedGbCharacters = importLibraryCharacters
    ? (await (async () => {
        const apiKey = process.env.GO_BANANAS_API_KEY?.trim();
        if (!apiKey) {
          throw new Error('GO_BANANAS_API_KEY is required when using --import-library-characters');
        }
        const characters = await findLibraryCharactersByIntent(intent, apiKey, apiUrl);
        for (const character of characters) {
          await addCharacterProfile(workspace, {
            name: character.character_name,
            goBananasId: character.id,
            ...(character.description ? { description: character.description } : {}),
            referenceAssets: [`gobananas://character/${character.id}`],
            notes: ['Imported from `video create --import-library-characters`.'],
          });
        }
        return characters.map((character) => ({
          name: character.character_name,
          goBananasId: character.id,
          sourceNote: 'Imported from `video create --import-library-characters`.',
        }));
      })())
    : [];
  const autoCreatedGbCharacters = autoCreateCharactersPath
    ? (await (async () => {
        const inputs = JSON.parse(await readFile(autoCreateCharactersPath, 'utf-8')) as Array<{
          name?: string;
          description?: string;
          style?: string;
        }>;
        if (!Array.isArray(inputs)) {
          throw new Error('--auto-create-characters must point to a JSON array');
        }
        const results = await autoCreateCharacters(
          inputs.flatMap((entry) => {
            const name = entry.name?.trim();
            const description = entry.description?.trim();
            if (!name || !description) return [];
            return [{
              name,
              description,
              ...(entry.style?.trim() ? { style: entry.style.trim() } : {}),
            }];
          }),
          {
            projectSlug: slug,
            root,
            apiUrl,
            dryRun,
          },
        );
        return Object.entries(results)
          .filter(([, result]) => result.characterId > 0)
          .map(([name, result]) => ({
            name,
            goBananasId: result.characterId,
            sourceNote: 'Created via `video create --auto-create-characters`.',
          }));
      })())
    : [];
  const gbCharacters = mergeGbCharacters(explicitGbCharacters, importedGbCharacters, autoCreatedGbCharacters);
  const characterNames = gbCharacters.map((entry) => entry.name);
  const characterHydration = {
    explicit: explicitGbCharacters,
    imported: importedGbCharacters,
    autoCreated: autoCreatedGbCharacters,
    final: gbCharacters,
  };

  for (const character of gbCharacters) {
    await addCharacterProfile(workspace, {
      name: character.name,
      goBananasId: character.goBananasId,
      referenceAssets: [`gobananas://character/${character.goBananasId}`],
      ...(character.sourceNote ? { notes: [character.sourceNote] } : {}),
    });
  }
  if (gbCharacters.length > 0) {
    await appendProjectEvent(workspace, {
      type: 'character.hydrated',
      payload: {
        explicit: explicitGbCharacters.map((entry) => ({ name: entry.name, goBananasId: entry.goBananasId })),
        imported: importedGbCharacters.map((entry) => ({ name: entry.name, goBananasId: entry.goBananasId })),
        autoCreated: autoCreatedGbCharacters.map((entry) => ({ name: entry.name, goBananasId: entry.goBananasId })),
        final: gbCharacters.map((entry) => ({ name: entry.name, goBananasId: entry.goBananasId })),
      },
    });
  }

  const executionProfile = applyPlatformExecutionProfileDefaults(
    platform ?? (typeof existingBriefMetadata.platform === 'string' ? existingBriefMetadata.platform : undefined),
    {
      ...(((existingBriefMetadata.executionProfile && typeof existingBriefMetadata.executionProfile === 'object')
        ? existingBriefMetadata.executionProfile
        : {}) as Record<string, unknown>),
      ...parseExecutionProfileFlags(args),
    },
  );
  const briefArtifact = createBriefArtifact({
    title,
    intent,
    productionMode: mode,
    metadata: {
      ...existingBriefMetadata,
      ...(genre ? { genre } : {}),
      ...(genreDefaults?.runtimeSeconds ? { targetRuntimeSeconds: genreDefaults.runtimeSeconds } : {}),
      ...(genreDefaults?.durationSeconds ? { clipDurationSeconds: genreDefaults.durationSeconds } : {}),
      ...((platform ?? existingBriefMetadata.platform) ? { platform: (platform ?? existingBriefMetadata.platform) as string } : {}),
      ...((style ?? existingBriefMetadata.style) ? { style: (style ?? existingBriefMetadata.style) as string } : {}),
      ...((colorGrading ?? existingBriefMetadata.colorGrading) ? { colorGrading: (colorGrading ?? existingBriefMetadata.colorGrading) as string } : {}),
      ...((gbCharacters.length > 0
        ? gbCharacters
        : (Array.isArray(existingBriefMetadata.goBananasCharacters) ? existingBriefMetadata.goBananasCharacters : undefined))
        ? {
            goBananasCharacters: (gbCharacters.length > 0
              ? gbCharacters
              : existingBriefMetadata.goBananasCharacters) as Array<{ name?: string; goBananasId?: number }>,
          }
        : {}),
      ...(Object.keys(executionProfile).length > 0 ? { executionProfile } : {}),
      sourceCommand: 'video create',
    },
  });
  const briefPath = await writeArtifact(workspace, 'brief', briefArtifact);
  await writeStageCheckpoint(workspace, {
    stage: 'brief',
    status: 'completed',
    generatedAt: briefArtifact.createdAt,
    artifacts: {
      brief: briefPath,
    },
    summary: 'Brief artifact created from video create.',
    issues: [],
    nextAction: 'Draft the storyboard artifact.',
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.brief.written',
    recordedAt: briefArtifact.createdAt,
    payload: buildBriefEventPayload({
      artifactPath: briefPath,
      title: briefArtifact.title,
      ...(typeof genreDefaults?.runtimeSeconds === 'number' ? { targetRuntimeSeconds: genreDefaults.runtimeSeconds } : {}),
      ...(typeof genreDefaults?.durationSeconds === 'number' ? { clipDurationSeconds: genreDefaults.durationSeconds } : {}),
      genre,
      platform: platform ?? undefined,
      executionProfile,
      source: 'video-create',
    }),
  });
  await updateProjectManifestState(workspace, {
    updatedAt: briefArtifact.createdAt,
    currentStage: 'storyboard',
    lastCompletedStage: 'brief',
    lastCheckpointStatus: 'completed',
  });

  const storyboardArtifact = createStoryboardArtifact({
    projectSlug: slug,
    productionMode: mode,
    scenes: buildCreateStoryboardScenes({
      intent,
      sceneCount,
      mode,
      characterNames,
      genre,
      tone: genreDefaults?.tone,
      actStructure: genreDefaults?.actStructure,
      style: style ?? undefined,
      colorGrading: colorGrading ?? undefined,
      durationSeconds: genreDefaults?.durationSeconds,
    }),
  });
  const storyboardPath = await writeArtifact(workspace, 'storyboard', storyboardArtifact);
  await writeStageCheckpoint(workspace, {
    stage: 'storyboard',
    status: 'completed',
    generatedAt: new Date().toISOString(),
    artifacts: {
      storyboard: storyboardPath,
    },
    summary: 'Storyboard artifact created from video create.',
    issues: [],
    nextAction: mode === 'director' ? 'Generate a storyboard review before approval.' : 'Create or attach scene assets.',
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.storyboard.written',
    payload: { artifactPath: storyboardPath, sceneCount: storyboardArtifact.scenes.length, source: 'video-create' },
  });
  await updateProjectManifestState(workspace, {
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'completed',
  });

  const seedAssets = await scaffoldExecutionSeedAssetsFromStoryboard(slug, root);
  await writeStageCheckpoint(workspace, {
    stage: 'assets',
    status: mode === 'director' ? 'pending' : 'completed',
    generatedAt: new Date().toISOString(),
    artifacts: {
      'asset-manifest': seedAssets.artifactPath,
    },
    summary: 'Seed asset manifest scaffolded from storyboard scenes.',
    issues: [],
    nextAction: mode === 'director' ? 'Review the generated storyboard markdown before execution.' : 'Run execution planning or execute the project.',
  });
  if (mode !== 'director') {
    await updateProjectManifestState(workspace, {
      currentStage: 'assets',
      lastCompletedStage: 'storyboard',
      lastCheckpointStatus: 'completed',
    });
  }

  let review: Awaited<ReturnType<typeof writeStoryboardMarkdownReview>> | null = null;
  let preflight: Awaited<ReturnType<typeof runDirectorPreflight>> | null = null;
  let costEstimate: Awaited<ReturnType<typeof buildProjectCostEstimate>> | null = null;
  let applied: Awaited<ReturnType<typeof autoFixDirectorStoryboardContent>> | null = null;
  let execution: Awaited<ReturnType<typeof executeProject>> | null = null;
  let handoff: { reviewCommand: string; approvalCommand: string; verifyEnvCommand: string } | null = null;
  if (mode === 'director') {
    applied = applyContentFixes ? await autoFixDirectorStoryboardContent(slug, root) : null;
    preflight = await runDirectorPreflight(slug, root);
    const plan = await buildExecutionPlan(slug, root, mode);
    costEstimate = await buildProjectCostEstimate({
      projectSlug: slug,
      root,
      newCharacterCount: autoCreatedGbCharacters.length,
    });
    review = await writeStoryboardMarkdownReview({
      projectSlug: slug,
      root,
      executionPlan: plan,
      costEstimate,
      preflight,
    });
    handoff = {
      reviewCommand: buildStoryboardReviewCommand(slug, root),
      approvalCommand: buildStoryboardApprovalCommand(slug, root),
      verifyEnvCommand: buildVerifyEnvCommand(root),
    };
    const generatedAt = new Date().toISOString();
    await writeStageCheckpoint(workspace, {
      stage: 'storyboard',
      status: preflight.pass ? 'awaiting-approval' : 'failed',
      generatedAt,
      artifacts: {
        storyboard: artifactPathFor(workspace, 'storyboard'),
      },
      summary: preflight.pass
        ? 'Storyboard review generated and awaiting approval.'
        : 'Storyboard review generated, but director preflight failed.',
      issues: preflight.errors.map((issue) => issue.message),
      nextAction: preflight.pass
        ? `Review ${review.markdownPath} and approve execution.`
        : `Review ${review.markdownPath}, fix the preflight errors, and rerun storyboard-review.`,
    });
    await updateProjectManifestState(workspace, {
      updatedAt: generatedAt,
      currentStage: 'storyboard',
      lastCompletedStage: 'brief',
      lastCheckpointStatus: preflight.pass ? 'awaiting-approval' : 'failed',
    });
    await appendProjectEvent(workspace, {
      type: 'storyboard.review.generated',
      payload: {
        markdownPath: review.markdownPath,
        routeId: plan.recommendedRouteId,
        mode,
        preflightPass: preflight.pass,
        appliedContentFixes: applied?.changeCount ?? 0,
        source: 'video-create',
      },
    });
  }

  if (execute) {
    execution = await executeProject(slug, {
      root,
      productionMode: mode,
      dryRun,
    });
  }

  await appendVideoContextChangelog(root, `${new Date().toISOString()} create: initialized ${slug} via video create (${mode}).`);
  process.stdout.write(`${JSON.stringify({
    workspace,
    slug,
    title,
    ...(genre ? { genre } : {}),
    sceneCount,
    ...(resolvedDefaults ? { resolvedDefaults } : {}),
    ...(gbCharacters.length > 0 ? { characterHydration } : {}),
    briefPath,
    storyboardPath,
    seedAssetManifestPath: seedAssets.artifactPath,
    review,
    preflight,
    costEstimate,
    handoff,
    applied,
    execution,
  }, null, 2)}\n`);
}

async function handleVideoAuto(args: string[]): Promise<void> {
  const normalizedArgs = [...args];
  if (!normalizedArgs.includes('--production-mode') && !normalizedArgs.includes('--mode')) {
    normalizedArgs.push('--production-mode', 'director');
  }
  await handleVideoCreate(normalizedArgs);
}

async function handleVideoIterate(args: string[]): Promise<void> {
  const normalizedArgs = [...args];
  if (!normalizedArgs.includes('--production-mode') && !normalizedArgs.includes('--mode')) {
    normalizedArgs.push('--production-mode', 'director');
  }
  if (!normalizedArgs.includes('--execute')) {
    normalizedArgs.push('--execute');
  }
  await handleVideoCreate(normalizedArgs);
}

async function handleVideoRunPipeline(args: string[]): Promise<void> {
  const normalizedArgs = [...args];
  if (!normalizedArgs.includes('--production-mode') && !normalizedArgs.includes('--mode')) {
    normalizedArgs.push('--production-mode', 'director');
  }
  if (!normalizedArgs.includes('--execute')) {
    normalizedArgs.push('--execute');
  }
  await handleVideoCreate(normalizedArgs);
}

async function handleVideoApprove(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video approve requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'director') as VideoProductionMode;
  const dryRun = args.includes('--dry-run');
  const result = await executeProject(projectSlug, {
    root,
    productionMode: mode,
    dryRun,
    env: {
      ...process.env,
      VIDEOCLAW_APPROVE_STORYBOARD: '1',
    },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoInit(args: string[]): Promise<void> {
  const slug = args[0];
  if (!slug) {
    throw new VclawError(
      'missing_required_flag',
      'video init requires a project slug',
      { flag: '<slug>' },
    );
  }
  validateInitSlug(slug);
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const pipeline = getBuiltinPipelineManifest(mode);
  const workspace = await ensureProjectWorkspace(slug, root);
  const now = new Date().toISOString();
  await writeProjectManifest(workspace, {
    slug,
    productionMode: mode,
    createdAt: now,
    updatedAt: now,
    pipeline,
    currentStage: 'brief',
    lastCompletedStage: null,
    lastCheckpointStatus: 'pending',
  });
  await writeStageCheckpoint(workspace, {
    stage: 'brief',
    status: 'pending',
    generatedAt: now,
    artifacts: {},
    summary: 'Project initialized; brief not yet created.',
    issues: [],
    nextAction: 'Create the brief artifact.',
  });
  await appendProjectEvent(workspace, {
    type: 'project.initialized',
    recordedAt: now,
    payload: { productionMode: mode, pipeline: pipeline.name },
  });
  process.stdout.write(`${JSON.stringify({ workspace, mode, pipeline: pipeline.name }, null, 2)}\n`);
}

async function handleVideoSetMeta(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new Error('video set-meta requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const workspace = await ensureProjectWorkspace(slug, root);
  const updated = await updateProjectManifestMetadata(workspace, {
    ...(parseFlagValue(args, '--owner') !== undefined ? { owner: parseFlagValue(args, '--owner') ?? null } : {}),
    ...(parseFlagValue(args, '--priority') !== undefined ? { priority: (parseFlagValue(args, '--priority') ?? null) as 'low' | 'medium' | 'high' | 'critical' | null } : {}),
    ...(parseFlagValue(args, '--due') !== undefined ? { dueDate: parseFlagValue(args, '--due') ?? null } : {}),
    ...(args.includes('--tag') ? { tags: parseRepeatableFlag(args, '--tag') } : {}),
    ...(args.includes('--blocked-by') ? { blockedBy: parseRepeatableFlag(args, '--blocked-by') } : {}),
    ...(parseFlagValue(args, '--blocked-reason') !== undefined ? { blockedReason: parseFlagValue(args, '--blocked-reason') ?? null } : {}),
  });
  process.stdout.write(`${JSON.stringify({ workspace, manifest: updated }, null, 2)}\n`);
}

async function handleVideoSetExecutionProfile(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new Error('video set-execution-profile requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const audioRaw = parseFlagValue(args, '--audio');
  const profile = parseExecutionProfileInput({
    aspectRatio: parseFlagValue(args, '--aspect-ratio'),
    quality: parseFlagValue(args, '--quality'),
    resolution: parseFlagValue(args, '--resolution'),
    generateAudio: audioRaw === undefined ? undefined : audioRaw === 'on' ? true : audioRaw === 'off' ? false : undefined,
    outputCount: parseFlagValue(args, '--outputs') ? Number(parseFlagValue(args, '--outputs')) : undefined,
  });
  const result = await setExecutionProfileOverrides(slug, profile, root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoCostEstimate(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const scenesRaw = parseFlagValue(args, '--scenes');
  const clipDurationRaw = parseFlagValue(args, '--clip-duration');
  const newCharactersRaw = parseFlagValue(args, '--new-characters');
  const narrationRaw = parseFlagValue(args, '--narration');
  const narrationEnabled = narrationRaw === undefined
    ? undefined
    : narrationRaw === 'on'
      ? true
      : narrationRaw === 'off'
        ? false
        : undefined;

  const estimate = projectSlug
    ? await buildProjectCostEstimate({
        projectSlug,
        root,
        ...(scenesRaw ? { sceneCount: Number(scenesRaw) } : {}),
        ...(clipDurationRaw ? { clipDurationSeconds: Number(clipDurationRaw) } : {}),
        ...(newCharactersRaw ? { newCharacterCount: Number(newCharactersRaw) } : {}),
        ...(narrationEnabled !== undefined ? { narrationEnabled } : {}),
      })
    : buildVideoCostEstimate({
        sceneCount: scenesRaw ? Number(scenesRaw) : 14,
        clipDurationSeconds: clipDurationRaw ? Number(clipDurationRaw) : 15,
        ...(newCharactersRaw ? { newCharacterCount: Number(newCharactersRaw) } : {}),
        ...(narrationEnabled !== undefined ? { narrationEnabled } : {}),
      });

  process.stdout.write(`${JSON.stringify({
    ...(projectSlug ? { projectSlug } : {}),
    estimate,
  }, null, 2)}\n`);
}

async function handleVideoVerifyEnv(args: string[]): Promise<void> {
  const workspaceRoot = parseFlagValue(args, '--workspace-root') ?? parseFlagValue(args, '--root') ?? process.cwd();
  const report = buildVideoEnvironmentReport({
    workspaceRoot,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function handleVideoArchiveProject(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video archive-project requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const archiveDir = parseFlagValue(args, '--archive-dir') ?? undefined;
  const cleanup = args.includes('--cleanup');
  const result = await archiveProject({
    projectSlug,
    root,
    ...(archiveDir ? { archiveDir } : {}),
    cleanup,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoCharacterAdd(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const name = parseFlagValue(args, '--name');
  if (!projectSlug || !name) {
    throw new Error('video character-add requires --project <slug> and --name <name>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const character = await addCharacterProfile(workspace, {
    name,
    ...(parseFlagValue(args, '--gb-id') ? { goBananasId: Number(parseFlagValue(args, '--gb-id')) } : {}),
    ...(parseFlagValue(args, '--description') ? { description: parseFlagValue(args, '--description') } : {}),
    ...(args.includes('--ref') ? { referenceAssets: parseRepeatableFlag(args, '--ref') } : {}),
    ...(args.includes('--note') ? { notes: parseRepeatableFlag(args, '--note') } : {}),
  });
  await appendProjectEvent(workspace, {
    type: 'character.added',
    payload: { id: character.id, name: character.name },
  });
  process.stdout.write(`${JSON.stringify({ workspace, character }, null, 2)}\n`);
}

async function handleVideoCharacterAutoCreate(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const inputPath = parseFlagValue(args, '--input');
  if (!projectSlug || !inputPath) {
    throw new Error('video character-auto-create requires --project <slug> and --input <json-path>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const apiUrl = parseFlagValue(args, '--api-url') ?? undefined;
  const dryRun = args.includes('--dry-run');
  const inputs = JSON.parse(await readFile(inputPath, 'utf-8')) as Array<{
    name?: string;
    description?: string;
    style?: string;
  }>;
  if (!Array.isArray(inputs)) {
    throw new Error('video character-auto-create input must be a JSON array');
  }
  const results = await autoCreateCharacters(
    inputs.flatMap((entry) => {
      const name = entry.name?.trim();
      const description = entry.description?.trim();
      if (!name || !description) return [];
      return [{
        name,
        description,
        ...(entry.style?.trim() ? { style: entry.style.trim() } : {}),
      }];
    }),
    {
      projectSlug,
      root,
      ...(apiUrl ? { apiUrl } : {}),
      dryRun,
    },
  );
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  await appendProjectEvent(workspace, {
    type: 'character.auto-created',
    payload: { inputPath, characterNames: Object.keys(results), dryRun },
  });
  process.stdout.write(`${JSON.stringify({ workspace, inputPath, dryRun, results }, null, 2)}\n`);
}

async function handleVideoCharacterImportLibrary(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const intent = parseFlagValue(args, '--intent');
  if (!projectSlug || !intent) {
    throw new Error('video character-import-library requires --project <slug> and --intent <text>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const apiKey = process.env.GO_BANANAS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GO_BANANAS_API_KEY is required for video character-import-library');
  }
  const apiUrl = parseFlagValue(args, '--api-url') ?? process.env.GO_BANANAS_API_URL ?? 'https://gobananasai.com/api';
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const characters = await findLibraryCharactersByIntent(intent, apiKey, apiUrl);
  const imported = [];
  for (const character of characters) {
    imported.push(await addCharacterProfile(workspace, {
      name: character.character_name,
      goBananasId: character.id,
      ...(character.description ? { description: character.description } : {}),
      referenceAssets: [`gobananas://character/${character.id}`],
    }));
  }
  await appendProjectEvent(workspace, {
    type: 'character.library-imported',
    payload: { intent, importedCharacterIds: imported.map((character) => character.goBananasId).filter(Boolean) },
  });
  process.stdout.write(`${JSON.stringify({ workspace, intent, imported }, null, 2)}\n`);
}

async function handleVideoCharacterList(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video character-list requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const characters = await listCharacterProfiles(workspace);
  process.stdout.write(`${JSON.stringify({ workspace, characters }, null, 2)}\n`);
}

async function handleVideoCharacterShow(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const name = parseFlagValue(args, '--name');
  if (!projectSlug || !name) {
    throw new Error('video character-show requires --project <slug> and --name <name>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const character = await readCharacterProfile(workspace, name);
  process.stdout.write(`${JSON.stringify({ workspace, character }, null, 2)}\n`);
}

async function handleVideoCharacterConsistency(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video character-consistency requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const report = await buildCharacterConsistencyReport(projectSlug, root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const GB_REF_KINDS: readonly GbRefKind[] = [
  'character',
  'product',
  'scene',
  'style-preset',
  'reference-group',
];

async function handleVideoReferenceSheetAdd(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const typeRaw = parseFlagValue(args, '--type');
  const name = parseFlagValue(args, '--name');
  if (!projectSlug || !typeRaw || !name) {
    throw new Error('video reference-sheet-add requires --project <slug>, --type <type>, and --name <name>');
  }
  const type = typeRaw as ReferenceSheetType;
  if (!REFERENCE_SHEET_TYPES.includes(type)) {
    throw new Error(
      `unknown-sheet-type: ${typeRaw}. Expected one of: ${REFERENCE_SHEET_TYPES.join(', ')}`,
    );
  }

  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const id = parseFlagValue(args, '--id');
  const description = parseFlagValue(args, '--description');
  const characterName = parseFlagValue(args, '--character-name');

  const artifact = await readReferenceSheetsArtifact(root, projectSlug);
  const now = new Date();
  let sheet = createSheet({
    type,
    name,
    existingIds: artifact.sheets.map((s) => s.id),
    now,
    ...(id ? { id } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(characterName !== undefined ? { characterName } : {}),
  });

  for (const raw of parseRepeatableFlag(args, '--ref')) {
    const firstColon = raw.indexOf(':');
    if (firstColon < 0) {
      throw new Error(`malformed --ref: ${raw}. Expected path:role[:note]`);
    }
    const path = raw.slice(0, firstColon);
    const remainder = raw.slice(firstColon + 1);
    const secondColon = remainder.indexOf(':');
    const role = secondColon < 0 ? remainder : remainder.slice(0, secondColon);
    const note = secondColon < 0 ? undefined : remainder.slice(secondColon + 1);
    if (!path || !role) {
      throw new Error(`malformed --ref: ${raw}. Expected path:role[:note]`);
    }
    if (!isRoleValidForType(role as ReferenceRole, type)) {
      throw new VclawError(
        'invalid_role',
        `role-vocabulary-violation: role=${role} not valid for sheet-type=${type}. ` +
          `Allowed: ${ROLE_VOCABULARY[type].join(', ')}`,
        { role, sheetType: type, allowed: ROLE_VOCABULARY[type] },
      );
    }
    sheet = addReferenceToSheet(
      sheet,
      {
        path,
        role: role as ReferenceRole,
        ...(note !== undefined && note.length > 0 ? { note } : {}),
      },
      now,
    );
  }

  for (const raw of parseRepeatableFlag(args, '--gb-ref')) {
    const parts = raw.split(':');
    if (parts.length < 3) {
      throw new Error(`malformed --gb-ref: ${raw}. Expected kind:id:role[:note]`);
    }
    const [kindRaw, idStr, roleRaw, ...noteParts] = parts;
    if (!GB_REF_KINDS.includes(kindRaw as GbRefKind)) {
      throw new Error(
        `unknown gb-ref kind: ${kindRaw}. Expected one of: ${GB_REF_KINDS.join(', ')}`,
      );
    }
    const gbId = Number(idStr);
    if (!Number.isInteger(gbId) || gbId < 1) {
      throw new Error(`invalid gb-ref id: ${idStr}`);
    }
    if (!isRoleValidForType(roleRaw as ReferenceRole, type)) {
      throw new VclawError(
        'invalid_role',
        `role-vocabulary-violation: role=${roleRaw} not valid for sheet-type=${type}. ` +
          `Allowed: ${ROLE_VOCABULARY[type].join(', ')}`,
        { role: roleRaw, sheetType: type, allowed: ROLE_VOCABULARY[type] },
      );
    }
    const gbNote = noteParts.length > 0 ? noteParts.join(':') : undefined;
    sheet = addReferenceToSheet(
      sheet,
      {
        gbRef: { kind: kindRaw as GbRefKind, id: gbId },
        role: roleRaw as ReferenceRole,
        ...(gbNote !== undefined && gbNote.length > 0 ? { note: gbNote } : {}),
      },
      now,
    );
  }

  const bindingRaw = parseRepeatableFlag(args, '--binding');
  const sceneIndices = bindingRaw.map((s) => Number(s));
  for (const [i, idx] of sceneIndices.entries()) {
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`invalid --binding value: ${bindingRaw[i]}. Expected a non-negative integer.`);
    }
  }
  if (sceneIndices.length > 0) {
    sheet = bindSheetToScenes(sheet, sceneIndices, now);
  }

  const updated = upsertSheet(artifact, sheet);
  await writeReferenceSheetsArtifact(root, projectSlug, updated);

  process.stdout.write(
    `${JSON.stringify({ sheet, summary: summarizeArtifact(updated) }, null, 2)}\n`,
  );
}

function parseSceneCharacters(args: string[]): Map<number, string[]> {
  const assignments = parseRepeatableFlag(args, '--scene-character');
  const charactersByScene = new Map<number, string[]>();
  for (const assignment of assignments) {
    const separatorIndex = assignment.indexOf(':');
    if (separatorIndex < 0) {
      throw new Error(`Invalid --scene-character value: "${assignment}". Expected sceneIndex:name`);
    }
    const sceneIndex = Number(assignment.slice(0, separatorIndex));
    const name = assignment.slice(separatorIndex + 1).trim();
    if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || !name) {
      throw new Error(`Invalid --scene-character value: "${assignment}". Expected sceneIndex:name`);
    }
    const current = charactersByScene.get(sceneIndex) ?? [];
    current.push(name);
    charactersByScene.set(sceneIndex, current);
  }
  return charactersByScene;
}

async function handleVideoReferenceSheetList(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video reference-sheet-list requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const typeFilter = parseFlagValue(args, '--type');
  const artifact = await readReferenceSheetsArtifact(root, projectSlug);
  const sheets = typeFilter
    ? artifact.sheets.filter((s) => s.type === typeFilter)
    : artifact.sheets;
  process.stdout.write(
    `${JSON.stringify({ sheets, summary: summarizeArtifact(artifact) }, null, 2)}\n`,
  );
}

async function handleVideoReferenceSheetShow(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const id = parseFlagValue(args, '--id');
  if (!projectSlug || !id) {
    throw new Error('video reference-sheet-show requires --project <slug> and --id <sheet-id>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const artifact = await readReferenceSheetsArtifact(root, projectSlug);
  const sheet = findSheet(artifact, id);
  if (!sheet) {
    throw new Error(`unknown sheet: ${id}`);
  }
  process.stdout.write(`${JSON.stringify({ sheet }, null, 2)}\n`);
}

async function handleVideoReferenceSheetBind(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const id = parseFlagValue(args, '--id');
  if (!projectSlug || !id) {
    throw new Error('video reference-sheet-bind requires --project <slug> and --id <sheet-id>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const sceneRaw = parseRepeatableFlag(args, '--scene');
  if (sceneRaw.length === 0) {
    throw new Error('video reference-sheet-bind requires at least one --scene <sceneIndex>');
  }
  const sceneIndices = sceneRaw.map((s) => Number(s));
  for (const [i, idx] of sceneIndices.entries()) {
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`invalid --scene value: ${sceneRaw[i]}. Expected a non-negative integer.`);
    }
  }
  const artifact = await readReferenceSheetsArtifact(root, projectSlug);
  const sheet = findSheet(artifact, id);
  if (!sheet) {
    throw new Error(`unknown sheet: ${id}`);
  }
  const now = new Date();
  const updatedSheet = bindSheetToScenes(sheet, sceneIndices, now);
  const updated = upsertSheet(artifact, updatedSheet);
  await writeReferenceSheetsArtifact(root, projectSlug, updated);
  process.stdout.write(`${JSON.stringify({ sheet: updatedSheet }, null, 2)}\n`);
}

async function handleVideoReferenceSheetValidate(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video reference-sheet-validate requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const artifact = await readReferenceSheetsArtifact(root, projectSlug);
  const validation = validateArtifact(artifact);
  const collisions = findRoleCollisions(artifact);
  const ok = validation.ok && collisions.length === 0;
  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        errors: validation.errors,
        collisions,
        summary: summarizeArtifact(artifact),
      },
      null,
      2,
    )}\n`,
  );
}

async function handleVideoCandidatesList(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video candidates-list requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const sceneRaw = parseFlagValue(args, '--scene');
  const artifact = await readSceneCandidatesArtifact(root, projectSlug);
  if (sceneRaw !== undefined) {
    const sceneIndex = Number(sceneRaw);
    if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
      throw new Error(`invalid --scene value: ${sceneRaw}. Expected a non-negative integer.`);
    }
    const candidates = candidatesForScene(artifact, sceneIndex);
    process.stdout.write(
      `${JSON.stringify(
        { sceneIndex, candidates, summary: summarizeCandidates(artifact) },
        null,
        2,
      )}\n`,
    );
    return;
  }
  process.stdout.write(
    `${JSON.stringify(
      { scenes: artifact.scenes, summary: summarizeCandidates(artifact) },
      null,
      2,
    )}\n`,
  );
}

async function handleVideoCandidatesShow(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const candidateId = parseFlagValue(args, '--candidate-id');
  if (!projectSlug || !candidateId) {
    throw new Error('video candidates-show requires --project <slug> and --candidate-id <id>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const artifact = await readSceneCandidatesArtifact(root, projectSlug);
  const found = findCandidate(artifact, candidateId);
  if (!found) {
    throw new Error(`unknown candidate: ${candidateId}`);
  }
  process.stdout.write(
    `${JSON.stringify(
      { sceneIndex: found.sceneIndex, candidate: found.candidate },
      null,
      2,
    )}\n`,
  );
}

async function handleVideoStoryboardStillAdd(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const imageUrl = parseFlagValue(args, '--image-url');
  if (!projectSlug || !imageUrl) {
    throw new Error('video storyboard-still-add requires --project <slug>, --scene <sceneIndex>, and --image-url <url>');
  }
  const sceneIndex = parseSceneIndexFlag(args);
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const imageId = parseFlagValue(args, '--image-id');
  const prompt = parseFlagValue(args, '--prompt');
  const notes = parseFlagValue(args, '--notes');
  const result = await recordStoryboardStillCandidate({
    root,
    projectSlug,
    sceneIndex,
    imageUrl,
    ...(imageId ? { imageId } : {}),
    ...(prompt ? { prompt } : {}),
    ...(notes ? { notes } : {}),
  });
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  await appendProjectEvent(workspace, {
    type: 'storyboard-still.candidate.added',
    payload: {
      sceneIndex,
      candidateId: result.candidate.id,
      imageUrl,
      ...(imageId ? { imageId } : {}),
      ...(notes ? { notes } : {}),
    },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseSceneIndexFlag(args: string[]): number {
  const raw = parseFlagValue(args, '--scene');
  if (raw === undefined) {
    throw new Error('missing --scene <sceneIndex>');
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`invalid --scene value: ${raw}. Expected a non-negative integer.`);
  }
  return value;
}

async function handleVideoSelectCandidate(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const candidateId = parseFlagValue(args, '--candidate-id');
  if (!projectSlug || !candidateId) {
    throw new Error(
      'video select-candidate requires --project <slug>, --scene <sceneIndex>, and --candidate-id <id>',
    );
  }
  const sceneIndex = parseSceneIndexFlag(args);
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const notes = parseFlagValue(args, '--notes');

  const candidatesArtifact = await readSceneCandidatesArtifact(root, projectSlug);
  const found = findCandidate(candidatesArtifact, candidateId);
  if (!found) {
    throw new Error(`unknown candidate: ${candidateId}`);
  }
  if (found.sceneIndex !== sceneIndex) {
    throw new Error(
      `candidate-scene-mismatch: candidate ${candidateId} belongs to scene ${found.sceneIndex}, not ${sceneIndex}`,
    );
  }

  const selection = await readSceneSelectionArtifact(root, projectSlug);
  let updated = selectCandidate(selection, sceneIndex, candidateId);
  if (notes !== undefined) {
    const idx = updated.scenes.findIndex((s) => s.sceneIndex === sceneIndex);
    if (idx >= 0) {
      const scenes = [...updated.scenes];
      scenes[idx] = { ...scenes[idx], notes };
      updated = { ...updated, scenes };
    }
  }
  await writeSceneSelectionArtifact(root, projectSlug, updated);

  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const derivedAssetManifest = deriveAssetManifestFromSelection(projectSlug, candidatesArtifact, updated);
  const existingAssetManifestPath = artifactPathFor(workspace, 'asset-manifest');
  const existingAssetCount = existsSync(existingAssetManifestPath)
    ? (() => {
        try {
          const parsed = JSON.parse(readFileSync(existingAssetManifestPath, 'utf-8')) as { assets?: unknown[] };
          return Array.isArray(parsed.assets) ? parsed.assets.length : 0;
        } catch {
          return 0;
        }
      })()
    : 0;
  const shouldWriteDerivedAssetManifest = derivedAssetManifest.assets.length > 0 || existingAssetCount === 0;
  const assetManifestPath = shouldWriteDerivedAssetManifest
    ? await writeArtifact(workspace, 'asset-manifest', derivedAssetManifest)
    : existingAssetManifestPath;
  await appendProjectEvent(workspace, {
    type: 'scene-candidate.selected',
    payload: {
      sceneIndex,
      candidateId,
      ...(notes !== undefined ? { notes } : {}),
    },
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.asset-manifest.written',
    payload: {
      artifactPath: assetManifestPath,
      assetCount: shouldWriteDerivedAssetManifest ? derivedAssetManifest.assets.length : existingAssetCount,
      source: shouldWriteDerivedAssetManifest ? 'select-candidate' : 'select-candidate-preserved',
    },
  });

  const entry = updated.scenes.find((s) => s.sceneIndex === sceneIndex);
  process.stdout.write(`${JSON.stringify({ sceneIndex, selection: entry }, null, 2)}\n`);
}

async function handleVideoRejectCandidate(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const candidateId = parseFlagValue(args, '--candidate-id');
  if (!projectSlug || !candidateId) {
    throw new Error(
      'video reject-candidate requires --project <slug>, --scene <sceneIndex>, and --candidate-id <id>',
    );
  }
  const sceneIndex = parseSceneIndexFlag(args);
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const notes = parseFlagValue(args, '--notes');

  const candidatesArtifact = await readSceneCandidatesArtifact(root, projectSlug);
  const found = findCandidate(candidatesArtifact, candidateId);
  if (!found) {
    throw new Error(`unknown candidate: ${candidateId}`);
  }
  if (found.sceneIndex !== sceneIndex) {
    throw new Error(
      `candidate-scene-mismatch: candidate ${candidateId} belongs to scene ${found.sceneIndex}, not ${sceneIndex}`,
    );
  }

  const selection = await readSceneSelectionArtifact(root, projectSlug);
  let updated = rejectCandidate(selection, sceneIndex, candidateId);
  if (notes !== undefined) {
    const idx = updated.scenes.findIndex((s) => s.sceneIndex === sceneIndex);
    if (idx >= 0) {
      const scenes = [...updated.scenes];
      scenes[idx] = { ...scenes[idx], notes };
      updated = { ...updated, scenes };
    }
  }
  await writeSceneSelectionArtifact(root, projectSlug, updated);

  const workspace = await ensureProjectWorkspace(projectSlug, root);
  await appendProjectEvent(workspace, {
    type: 'scene-candidate.rejected',
    payload: {
      sceneIndex,
      candidateId,
      ...(notes !== undefined ? { notes } : {}),
    },
  });

  const entry = updated.scenes.find((s) => s.sceneIndex === sceneIndex);
  process.stdout.write(`${JSON.stringify({ sceneIndex, selection: entry }, null, 2)}\n`);
}

function parseChainFromPrevFlag(args: string[]): boolean | undefined {
  const raw = parseFlagValue(args, '--chain-from-prev');
  if (raw === undefined) return undefined;
  if (raw === 'on' || raw === 'true') return true;
  if (raw === 'off' || raw === 'false') return false;
  throw new Error(`invalid --chain-from-prev value: ${raw}. Expected on|off.`);
}

async function handleVideoRerollScene(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video reroll-scene requires --project <slug> and --scene <sceneIndex>');
  }
  const sceneIndex = parseSceneIndexFlag(args);
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const chainFromPrev = parseChainFromPrevFlag(args);

  const selection = await readSceneSelectionArtifact(root, projectSlug);
  const updated = requestReroll(selection, sceneIndex, chainFromPrev);
  await writeSceneSelectionArtifact(root, projectSlug, updated);

  const workspace = await ensureProjectWorkspace(projectSlug, root);
  await appendProjectEvent(workspace, {
    type: 'scene-reroll.requested',
    payload: {
      sceneIndex,
      ...(chainFromPrev !== undefined ? { chainFromPrev } : {}),
    },
  });

  const entry = updated.scenes.find((s) => s.sceneIndex === sceneIndex);
  process.stdout.write(`${JSON.stringify({ sceneIndex, selection: entry }, null, 2)}\n`);
}

async function handleVideoChainFrom(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const fromRaw = parseFlagValue(args, '--from');
  if (!projectSlug || fromRaw === undefined) {
    throw new Error('video chain-from requires --project <slug>, --scene <sceneIndex>, and --from <sourceSceneIndex>');
  }
  const sceneIndex = parseSceneIndexFlag(args);
  const fromIndex = Number(fromRaw);
  if (!Number.isInteger(fromIndex) || fromIndex < 0) {
    throw new Error(`invalid --from value: ${fromRaw}. Expected a non-negative integer.`);
  }
  // v1: chain-from-prev only — source must be sceneIndex - 1.
  if (fromIndex !== sceneIndex - 1) {
    throw new Error(
      `chain-from-unsupported: v1 only supports chain-from-prev (--from must equal --scene - 1). ` +
        `Got --scene ${sceneIndex} --from ${fromIndex}.`,
    );
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();

  const selection = await readSceneSelectionArtifact(root, projectSlug);
  const updated = setChainFromPrev(selection, sceneIndex, true);
  await writeSceneSelectionArtifact(root, projectSlug, updated);

  const workspace = await ensureProjectWorkspace(projectSlug, root);
  await appendProjectEvent(workspace, {
    type: 'scene-chain.configured',
    payload: { sceneIndex, from: fromIndex, chainFromPrev: true },
  });

  const entry = updated.scenes.find((s) => s.sceneIndex === sceneIndex);
  process.stdout.write(`${JSON.stringify({ sceneIndex, selection: entry }, null, 2)}\n`);
}

async function handleVideoUnchain(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video unchain requires --project <slug> and --scene <sceneIndex>');
  }
  const sceneIndex = parseSceneIndexFlag(args);
  const root = parseFlagValue(args, '--root') ?? process.cwd();

  const selection = await readSceneSelectionArtifact(root, projectSlug);
  const updated = setChainFromPrev(selection, sceneIndex, false);
  await writeSceneSelectionArtifact(root, projectSlug, updated);

  const workspace = await ensureProjectWorkspace(projectSlug, root);
  await appendProjectEvent(workspace, {
    type: 'scene-chain.configured',
    payload: { sceneIndex, chainFromPrev: false },
  });

  const entry = updated.scenes.find((s) => s.sceneIndex === sceneIndex);
  process.stdout.write(`${JSON.stringify({ sceneIndex, selection: entry }, null, 2)}\n`);
}

async function handleVideoCandidatesMigrateFromAssets(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video candidates-migrate-from-assets requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const dryRun = args.includes('--dry-run');

  const result = await migrateCandidatesFromAssetManifest(root, projectSlug, { dryRun });
  process.stdout.write(
    `${JSON.stringify(
      {
        slug: result.slug,
        dryRun: result.dryRun,
        sceneCount: result.sceneCount,
        candidateIds: result.candidateIds,
        candidatesPath: result.candidatesPath,
        selectionPath: result.selectionPath,
      },
      null,
      2,
    )}\n`,
  );
}

async function handleVideoPlaybookList(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const playbooks = await listPlaybooks(root);
  process.stdout.write(`${JSON.stringify({ root, playbooks }, null, 2)}\n`);
}

async function handleVideoPlaybookShow(args: string[]): Promise<void> {
  const name = parseFlagValue(args, '--name');
  if (!name) {
    throw new Error('video playbook-show requires --name <playbook-name>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const playbook = await readPlaybook(name, root);
  process.stdout.write(`${JSON.stringify({ root, playbook }, null, 2)}\n`);
}

async function handleVideoLibrary(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (subcommand === 'find') {
    await handleVideoFindLibrary(rest);
    return;
  }
  if (subcommand !== 'clean') {
    throw new Error(`Unknown video library subcommand: ${subcommand ?? '(missing)'}\n\n${LIBRARY_HELP}`);
  }
  const exitCode = await runLibraryClean(parseLibraryCleanArgs(rest));
  process.exitCode = exitCode;
}

async function handleVideoPromptLibList(): Promise<void> {
  const references = listPromptReferences();
  process.stdout.write(`${JSON.stringify({ references }, null, 2)}\n`);
}

async function handleVideoPromptLibShow(args: string[]): Promise<void> {
  const name = parseFlagValue(args, '--name');
  if (!name) {
    throw new Error('video prompt-lib-show requires --name <reference-name>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const reference = await readPromptReference(name, root);
  process.stdout.write(`${JSON.stringify({ root, reference }, null, 2)}\n`);
}

async function handleVideoImportLegacy(args: string[]): Promise<void> {
  const source = parseFlagValue(args, '--source');
  if (!source) {
    throw new Error('video import-legacy requires --source <path>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const results = await importLegacyProjects(source, root);
  process.stdout.write(`${JSON.stringify({ source, root, results }, null, 2)}\n`);
}


async function handleVideoTemplateSave(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  const templateName = parseFlagValue(args, '--name');
  if (!projectSlug || !templateName) {
    throw new Error('video template-save requires --project <slug> and --name <template-name>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const result = await saveTemplateFromAnalyzeOutput({
    root,
    projectSlug,
    templateName,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoTemplateList(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const templates = await listTemplates(root);
  process.stdout.write(`${JSON.stringify({ root, templates }, null, 2)}\n`);
}

async function handleVideoTemplateShow(args: string[]): Promise<void> {
  const name = parseFlagValue(args, '--name');
  if (!name) {
    throw new Error('video template-show requires --name <template-name>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const template = await readTemplate(name, root);
  process.stdout.write(`${JSON.stringify({ root, template }, null, 2)}\n`);
}

async function handleVideoTemplateValidate(args: string[]): Promise<void> {
  const name = parseFlagValue(args, '--name');
  if (!name) {
    throw new Error('video template-validate requires --name <template-name>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const validation = await validateTemplate(name, root);
  process.stdout.write(`${JSON.stringify({ root, validation }, null, 2)}\n`);
}

async function handleVideoStoryboardTemplateList(): Promise<void> {
  process.stdout.write(`${JSON.stringify({ templates: listStoryboardTemplates() }, null, 2)}\n`);
}

async function handleVideoStoryboardTemplateShow(args: string[]): Promise<void> {
  const name = parseFlagValue(args, '--name');
  if (!name) {
    throw new Error('video storyboard-template-show requires --name <template-id>');
  }
  const template = readStoryboardTemplate(name);
  process.stdout.write(`${JSON.stringify({ template }, null, 2)}\n`);
}

async function handleVideoClonePlan(args: string[]): Promise<void> {
  const templateName = parseFlagValue(args, '--template');
  const projectSlug = parseFlagValue(args, '--project');
  const intent = parseFlagValue(args, '--intent');
  if (!templateName || !projectSlug || !intent) {
    throw new Error('video clone-plan requires --template <template-name>, --project <slug>, and --intent <text>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const plan = await buildClonePlan({
    root,
    templateName,
    projectSlug,
    intent,
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

async function handleVideoReadiness(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new Error('video readiness requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const readiness = await buildProjectReadiness(slug, root, mode);
  process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
}

async function handleVideoDirectorPreflight(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new Error('video director-preflight requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const applyContentFixes = args.includes('--apply-content-fixes');
  const applied = applyContentFixes ? await autoFixDirectorStoryboardContent(slug, root) : null;
  const result = await runDirectorPreflight(slug, root);
  process.exitCode = result.pass ? 0 : 1;
  process.stdout.write(`${JSON.stringify({ applied, result }, null, 2)}\n`);
}

async function handleVideoStoryboardReview(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new Error('video storyboard-review requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const workspace = await ensureProjectWorkspace(slug, root);
  const manifest = await readProjectManifest(workspace);
  const mode = (parseFlagValue(args, '--mode') ?? manifest?.productionMode ?? 'director') as VideoProductionMode;
  const applyContentFixes = args.includes('--apply-content-fixes');
  const applied = applyContentFixes && mode === 'director'
    ? await autoFixDirectorStoryboardContent(slug, root)
    : null;
  const plan = await buildExecutionPlan(slug, root, mode);
  const preflight = mode === 'director' ? await runDirectorPreflight(slug, root) : undefined;
  const review = await writeStoryboardMarkdownReview({
    projectSlug: slug,
    root,
    executionPlan: plan,
    preflight,
  });

  if (mode === 'director') {
    const generatedAt = new Date().toISOString();
    if (preflight?.pass === false) {
      await writeStageCheckpoint(workspace, {
        stage: 'storyboard',
        status: 'failed',
        generatedAt,
        artifacts: {
          storyboard: artifactPathFor(workspace, 'storyboard'),
        },
        summary: 'Storyboard review generated, but director preflight failed.',
        issues: preflight.errors.map((issue) => issue.message),
        nextAction: `Review ${review.markdownPath}, fix the preflight errors, and rerun storyboard-review.`,
      });
      await updateProjectManifestState(workspace, {
        updatedAt: generatedAt,
        currentStage: 'storyboard',
        lastCompletedStage: 'brief',
        lastCheckpointStatus: 'failed',
      });
    } else {
      await writeStageCheckpoint(workspace, {
        stage: 'storyboard',
        status: 'awaiting-approval',
        generatedAt,
        artifacts: {
          storyboard: artifactPathFor(workspace, 'storyboard'),
        },
        summary: 'Storyboard review generated and awaiting approval.',
        issues: [],
        nextAction: `Review ${review.markdownPath} and approve execution.`,
      });
      await updateProjectManifestState(workspace, {
        updatedAt: generatedAt,
        currentStage: 'storyboard',
        lastCompletedStage: 'brief',
        lastCheckpointStatus: 'awaiting-approval',
      });
    }
  }

  await appendProjectEvent(workspace, {
    type: 'storyboard.review.generated',
    payload: {
      markdownPath: review.markdownPath,
      routeId: plan.recommendedRouteId,
      mode,
      preflightPass: preflight?.pass ?? null,
      appliedContentFixes: applied?.changeCount ?? 0,
    },
  });
  process.exitCode = preflight && !preflight.pass ? 1 : 0;
  process.stdout.write(`${JSON.stringify({ applied, review, preflight, plan }, null, 2)}\n`);
}

async function handleVideoReviewUi(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video review-ui requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const host = parseFlagValue(args, '--host') ?? undefined;
  const portRaw = parseFlagValue(args, '--port');
  const parsedPort = portRaw ? Number(portRaw) : undefined;
  if (parsedPort !== undefined && (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535)) {
    throw new Error('video review-ui requires --port to be an integer between 1 and 65535');
  }
  const uiPath = parseFlagValue(args, '--ui-path') ?? undefined;
  const dryRun = args.includes('--dry-run');
  const launch = await launchReviewUi({
    root,
    projectSlug,
    ...(host ? { host } : {}),
    ...(parsedPort ? { port: parsedPort } : {}),
    ...(uiPath ? { uiPath } : {}),
    dryRun,
  });
  process.stdout.write(`${JSON.stringify(launch, null, 2)}\n`);
  if (!dryRun) {
    await new Promise(() => {});
  }
}

async function handleVideoReviewAutopilot(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video review-autopilot requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const template = parseFlagValue(args, '--template') ?? undefined;
  const character = parseFlagValue(args, '--character') ?? undefined;
  const runId = parseFlagValue(args, '--run-id') ?? undefined;
  const result = await runReviewAutopilot({
    root,
    projectSlug,
    ...(template ? { template } : {}),
    ...(character ? { character } : {}),
    ...(runId ? { runId } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoExecutionPlan(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new Error('video execution-plan requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const workspace = await ensureProjectWorkspace(slug, root);
  const plan = await buildExecutionPlan(slug, root, mode);
  const artifactPath = await writeArtifact(workspace, 'execution-plan', plan);
  await appendProjectEvent(workspace, {
    type: 'artifact.execution-plan.written',
    recordedAt: plan.generatedAt,
    payload: { artifactPath, routeId: plan.recommendedRouteId, operationKind: plan.operationKind },
  });
  process.stdout.write(`${JSON.stringify({ artifactPath, plan }, null, 2)}\n`);
}

async function handleVideoExecute(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new VclawError(
      'missing_required_flag',
      'video execute requires --project <slug>',
      { missing: ['--project'] },
    );
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const dryRun = args.includes('--dry-run');
  const sceneFlags = parseRepeatableFlag(args, '--scene');
  const sceneIndices = sceneFlags.length > 0
    ? sceneFlags.map((value) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) {
          throw new Error(`video execute --scene requires a non-negative integer, got ${value}`);
        }
        return n;
      })
    : undefined;
  const result = await executeProject(slug, {
    root,
    productionMode: mode,
    dryRun,
    ...(sceneIndices ? { sceneIndices } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoExecuteStatus(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new Error('video execute-status requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const result = await refreshExecutionStatus(slug, {
    root,
    productionMode: mode,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoExecuteCancel(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new Error('video execute-cancel requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  try {
    const result = await cancelExecution(slug, {
      root,
      productionMode: mode,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('Execution cancel unavailable for')) {
      throw error;
    }
    process.stdout.write(`${JSON.stringify({
      reportPath: null,
      report: {
        projectSlug: slug,
        productionMode: mode,
        status: 'blocked',
        blockers: [message],
      },
      cancellation: {
        status: 'unsupported',
        externalJobId: null,
        issues: [message],
        rawResult: null,
      },
    }, null, 2)}\n`);
  }
}

async function handleVideoCloneInit(args: string[]): Promise<void> {
  const templateName = parseFlagValue(args, '--template');
  const projectSlug = parseFlagValue(args, '--project');
  const intent = parseFlagValue(args, '--intent');
  if (!templateName || !projectSlug || !intent) {
    throw new Error('video clone-init requires --template <template-name>, --project <slug>, and --intent <text>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const existingManifest = await readProjectManifest(workspace);
  if (!existingManifest) {
    const pipeline = getBuiltinPipelineManifest(mode);
    const now = new Date().toISOString();
    await writeProjectManifest(workspace, {
      slug: projectSlug,
      productionMode: mode,
      createdAt: now,
      updatedAt: now,
      pipeline,
      currentStage: 'brief',
      lastCompletedStage: null,
      lastCheckpointStatus: 'pending',
    });
  }

  const clonePlan = await buildClonePlan({
    root,
    templateName,
    projectSlug,
    intent,
  });
  const platform = parseFlagValue(args, '--platform') ?? undefined;
  const executionProfile = applyPlatformExecutionProfileDefaults(
    platform,
    parseExecutionProfileFlags(args),
  );
  const clonePlanPath = await writeArtifact(workspace, 'clone-plan', clonePlan);
  const briefArtifact = createBriefArtifact({
    title: `${projectSlug} brief`,
    intent,
    productionMode: (await readProjectManifest(workspace))?.productionMode ?? mode,
    metadata: {
      templateName,
      clonePlanPath,
      ...(platform ? { platform } : {}),
      ...(Object.keys(executionProfile).length > 0 ? { executionProfile } : {}),
      recommendedPacing: clonePlan.recommendedPacing,
      recommendedMotionMode: clonePlan.recommendedMotionMode,
      beats: clonePlan.beats,
      keepFromReference: clonePlan.keepFromReference,
      adaptForIntent: clonePlan.adaptForIntent,
    },
  });
  const briefPath = await writeArtifact(workspace, 'brief', briefArtifact);
  await writeStageCheckpoint(workspace, {
    stage: 'brief',
    status: 'completed',
    generatedAt: briefArtifact.createdAt,
    artifacts: {
      'clone-plan': clonePlanPath,
      brief: briefPath,
    },
    summary: `Clone plan and seeded brief created from template "${templateName}".`,
    issues: [],
    nextAction: 'Draft the storyboard artifact.',
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.clone-plan.written',
    recordedAt: clonePlan.generatedAt,
    payload: { templateName, clonePlanPath, intent },
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.brief.written',
    recordedAt: briefArtifact.createdAt,
    payload: buildBriefEventPayload({
      artifactPath: briefPath,
      title: briefArtifact.title,
      platform,
      executionProfile,
    }),
  });
  await updateProjectManifestState(workspace, {
    updatedAt: briefArtifact.createdAt,
    currentStage: 'storyboard',
    lastCompletedStage: 'brief',
    lastCheckpointStatus: 'completed',
  });
  process.stdout.write(`${JSON.stringify({ workspace, clonePlanPath, briefPath, clonePlan, briefArtifact }, null, 2)}\n`);
}

async function handleVideoCloneExecute(args: string[]): Promise<void> {
  const templateName = parseFlagValue(args, '--template');
  const projectSlug = parseFlagValue(args, '--project');
  const intent = parseFlagValue(args, '--intent');
  if (!templateName || !projectSlug || !intent) {
    throw new Error('video clone-execute requires --template <template-name>, --project <slug>, and --intent <text>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const dryRun = args.includes('--dry-run');
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const existingManifest = await readProjectManifest(workspace);
  if (!existingManifest) {
    const pipeline = getBuiltinPipelineManifest(mode);
    const now = new Date().toISOString();
    await writeProjectManifest(workspace, {
      slug: projectSlug,
      productionMode: mode,
      createdAt: now,
      updatedAt: now,
      pipeline,
      currentStage: 'brief',
      lastCompletedStage: null,
      lastCheckpointStatus: 'pending',
    });
  }

  const clonePlan = await buildClonePlan({
    root,
    templateName,
    projectSlug,
    intent,
  });
  const platform = parseFlagValue(args, '--platform') ?? undefined;
  const executionProfile = applyPlatformExecutionProfileDefaults(
    platform,
    parseExecutionProfileFlags(args),
  );
  const clonePlanPath = await writeArtifact(workspace, 'clone-plan', clonePlan);
  const briefArtifact = createBriefArtifact({
    title: `${projectSlug} brief`,
    intent,
    productionMode: (await readProjectManifest(workspace))?.productionMode ?? mode,
    metadata: {
      templateName,
      clonePlanPath,
      ...(platform ? { platform } : {}),
      ...(Object.keys(executionProfile).length > 0 ? { executionProfile } : {}),
      recommendedPacing: clonePlan.recommendedPacing,
      recommendedMotionMode: clonePlan.recommendedMotionMode,
      beats: clonePlan.beats,
      keepFromReference: clonePlan.keepFromReference,
      adaptForIntent: clonePlan.adaptForIntent,
    },
  });
  const briefPath = await writeArtifact(workspace, 'brief', briefArtifact);
  await writeStageCheckpoint(workspace, {
    stage: 'brief',
    status: 'completed',
    generatedAt: briefArtifact.createdAt,
    artifacts: {
      'clone-plan': clonePlanPath,
      brief: briefPath,
    },
    summary: `Clone plan and seeded brief created from template "${templateName}".`,
    issues: [],
    nextAction: 'Draft the storyboard artifact.',
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.clone-plan.written',
    recordedAt: clonePlan.generatedAt,
    payload: { templateName, clonePlanPath, intent },
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.brief.written',
    recordedAt: briefArtifact.createdAt,
    payload: buildBriefEventPayload({
      artifactPath: briefPath,
      title: briefArtifact.title,
      platform,
      executionProfile,
    }),
  });
  await updateProjectManifestState(workspace, {
    updatedAt: briefArtifact.createdAt,
    currentStage: 'storyboard',
    lastCompletedStage: 'brief',
    lastCheckpointStatus: 'completed',
  });

  const storyboard = createStoryboardArtifact(buildStoryboardFromClonePlan(clonePlan, mode));
  const storyboardPath = await writeArtifact(workspace, 'storyboard', storyboard);
  await writeStageCheckpoint(workspace, {
    stage: 'storyboard',
    status: 'completed',
    generatedAt: new Date().toISOString(),
    artifacts: {
      storyboard: storyboardPath,
      'clone-plan': clonePlanPath,
    },
    summary: 'Storyboard generated from clone plan.',
    issues: [],
    nextAction: 'Execute generated storyboard.',
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.storyboard.written',
    payload: { artifactPath: storyboardPath, source: 'clone-plan' },
  });
  await updateProjectManifestState(workspace, {
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'completed',
  });

  const seedAssets = await scaffoldExecutionSeedAssetsFromStoryboard(projectSlug, root);
  const execution = await executeProject(projectSlug, {
    root,
    productionMode: mode,
    dryRun,
  });

  process.stdout.write(`${JSON.stringify({
    workspace,
    clonePlanPath,
    briefPath,
    storyboardPath,
    seedAssetManifestPath: seedAssets.artifactPath,
    execution,
  }, null, 2)}\n`);
}

async function handleVideoStoryboardFromClone(args: string[]): Promise<void> {
  const projectSlug = parseFlagValue(args, '--project');
  if (!projectSlug) {
    throw new Error('video storyboard-from-clone requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const clonePlanPath = artifactPathFor(workspace, 'clone-plan');
  const clonePlanRaw = await (await import('node:fs/promises')).readFile(clonePlanPath, 'utf-8');
  const clonePlan = JSON.parse(clonePlanRaw) as Awaited<ReturnType<typeof buildClonePlan>>;
  const storyboard = createStoryboardArtifact(
    buildStoryboardFromClonePlan(clonePlan, mode),
  );
  const artifactPath = await writeArtifact(workspace, 'storyboard', storyboard);
  await writeStageCheckpoint(workspace, {
    stage: 'storyboard',
    status: 'completed',
    generatedAt: new Date().toISOString(),
    artifacts: {
      storyboard: artifactPath,
      'clone-plan': clonePlanPath,
    },
    summary: 'Storyboard generated from clone plan.',
    issues: [],
    nextAction: 'Create or attach scene assets.',
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.storyboard.written',
    payload: { artifactPath, source: 'clone-plan' },
  });
  await updateProjectManifestState(workspace, {
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'completed',
  });
  process.stdout.write(`${JSON.stringify({ workspace, artifactPath, storyboard }, null, 2)}\n`);
}

async function handleVideoAnalyze(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  const source = parseFlagValue(args, '--source');
  if (!slug || !source) {
    throw new Error('video analyze requires --project <slug> and --source <path-or-url>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const workspace = await ensureProjectWorkspace(slug, root);
  const title = parseFlagValue(args, '--title') ?? basename(source);
  const durationRaw = parseFlagValue(args, '--duration');
  const pacing = (parseFlagValue(args, '--pacing') ?? 'mixed') as VideoAnalyzeOutput['pacing']['label'];
  const motion = (parseFlagValue(args, '--motion') ?? 'unknown') as VideoAnalyzeOutput['motionClassification']['primaryMode'];
  const beats = parseRepeatableFlag(args, '--beat');
  const keep = parseRepeatableFlag(args, '--keep');
  const change = parseRepeatableFlag(args, '--change');
  const reusableVariables = parseRepeatableFlag(args, '--var');
  const auto = args.includes('--auto');

  const artifact = auto
    ? await generateAnalyzeOutputWithGemini({
        source,
        title,
        durationSeconds: durationRaw ? Number(durationRaw) : undefined,
      })
    : createAnalyzeOutput({
        reference: {
          source,
          title,
          durationSeconds: durationRaw ? Number(durationRaw) : undefined,
        },
        pacing: {
          label: pacing,
          notes: [],
        },
        structure: {
          beats,
        },
        motionClassification: {
          primaryMode: motion,
          notes: [],
        },
        keep,
        change,
        reusableVariables,
      });

  const artifactPath = await writeArtifact(workspace, 'analyze-output', artifact);
  await writeStageCheckpoint(workspace, {
    stage: 'brief',
    status: 'completed',
    generatedAt: artifact.generatedAt,
    artifacts: {
      'analyze-output': artifactPath,
    },
    summary: 'Reference analysis artifact captured.',
    issues: [],
    nextAction: 'Use analyze output to draft the project brief and storyboard.',
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.analyze-output.written',
    recordedAt: artifact.generatedAt,
    payload: { artifactPath, source },
  });
  await updateProjectManifestState(workspace, {
    updatedAt: artifact.generatedAt,
    currentStage: 'storyboard',
    lastCompletedStage: 'brief',
    lastCheckpointStatus: 'completed',
  });
  await appendVideoContextChangelog(root, `${artifact.generatedAt} analyze: captured reference "${title}" for project ${slug}.`);
  process.stdout.write(`${JSON.stringify({ workspace, artifactPath, artifact }, null, 2)}\n`);
}

async function handleVideoBrief(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  const title = parseFlagValue(args, '--title');
  const intent = parseFlagValue(args, '--intent');
  if (!slug || !title || !intent) {
    const missing: string[] = [];
    if (!slug) missing.push('--project');
    if (!title) missing.push('--title');
    if (!intent) missing.push('--intent');
    throw new VclawError(
      'missing_required_flag',
      'video brief requires --project <slug>, --title <title>, and --intent <intent>',
      { missing },
    );
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const workspace = await ensureProjectWorkspace(slug, root);
  const existingBriefPath = artifactPathFor(workspace, 'brief');
  const existingBriefMetadata = existsSync(existingBriefPath)
    ? (JSON.parse(await readFile(existingBriefPath, 'utf-8')) as { metadata?: Record<string, unknown> }).metadata ?? {}
    : {};
  const platform = parseFlagValue(args, '--platform') ?? undefined;
  const executionProfile = applyPlatformExecutionProfileDefaults(
    platform ?? (typeof existingBriefMetadata.platform === 'string' ? existingBriefMetadata.platform : undefined),
    {
      ...(((existingBriefMetadata.executionProfile && typeof existingBriefMetadata.executionProfile === 'object')
        ? existingBriefMetadata.executionProfile
        : {}) as Record<string, unknown>),
      ...parseExecutionProfileFlags(args),
    },
  );

  const artifact = createBriefArtifact({
    title,
    intent,
    productionMode: mode,
    metadata: {
      ...existingBriefMetadata,
      ...(typeof existingBriefMetadata.genre === 'string' ? { genre: existingBriefMetadata.genre } : {}),
      ...((platform ?? existingBriefMetadata.platform) ? { platform: (platform ?? existingBriefMetadata.platform) as string } : {}),
      ...(Object.keys(executionProfile).length > 0 ? { executionProfile } : {}),
    },
  });
  const artifactPath = await writeArtifact(workspace, 'brief', artifact);
  await writeStageCheckpoint(workspace, {
    stage: 'brief',
    status: 'completed',
    generatedAt: artifact.createdAt,
    artifacts: {
      brief: artifactPath,
    },
    summary: 'Brief artifact created.',
    issues: [],
    nextAction: 'Draft the storyboard artifact.',
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.brief.written',
    recordedAt: artifact.createdAt,
    payload: buildBriefEventPayload({
      artifactPath,
      title,
      ...(typeof artifact.metadata?.targetRuntimeSeconds === 'number' ? { targetRuntimeSeconds: artifact.metadata.targetRuntimeSeconds } : {}),
      ...(typeof artifact.metadata?.clipDurationSeconds === 'number' ? { clipDurationSeconds: artifact.metadata.clipDurationSeconds } : {}),
      genre: typeof artifact.metadata?.genre === 'string' ? artifact.metadata.genre : undefined,
      platform: typeof artifact.metadata?.platform === 'string' ? artifact.metadata.platform : undefined,
      executionProfile,
    }),
  });
  await updateProjectManifestState(workspace, {
    updatedAt: artifact.createdAt,
    currentStage: 'storyboard',
    lastCompletedStage: 'brief',
    lastCheckpointStatus: 'completed',
  });
  await appendVideoContextChangelog(root, `${artifact.createdAt} brief: updated project ${slug} for ${mode} mode.`);

  process.stdout.write(`${JSON.stringify({ workspace, artifactPath, artifact }, null, 2)}\n`);
}

async function handleVideoStoryboard(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  const templateId = parseFlagValue(args, '--template');
  const scenes = parseRepeatableFlag(args, '--scene');
  if (!slug || (scenes.length === 0 && !templateId)) {
    const missing: string[] = [];
    if (!slug) missing.push('--project');
    if (scenes.length === 0 && !templateId) missing.push('--scene|--template');
    throw new VclawError(
      'missing_required_flag',
      'video storyboard requires --project <slug> and either --scene <text> or --template <template-id>',
      { missing },
    );
  }
  const charactersByScene = parseSceneCharacters(args);
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const workspace = await ensureProjectWorkspace(slug, root);
  const projectManifest = await readProjectManifest(workspace);
  const resolvedMode = projectManifest?.productionMode ?? mode;
  await assertStageReady(workspace, resolvedMode, 'storyboard');

  const resolvedScenes = templateId
    ? buildStoryboardScenesFromTemplate({
        templateId,
        environment: parseFlagValue(args, '--environment'),
        characterA: parseFlagValue(args, '--character-a'),
        characterB: parseFlagValue(args, '--character-b'),
      })
    : scenes.map((description, sceneIndex) => ({
        sceneIndex,
        description,
      }));

  const artifact = createStoryboardArtifact({
    projectSlug: slug,
    productionMode: resolvedMode,
    scenes: resolvedScenes.map((scene) => ({
      sceneIndex: scene.sceneIndex,
      description: scene.description,
      ...(charactersByScene.has(scene.sceneIndex) ? { characters: charactersByScene.get(scene.sceneIndex) } : {}),
    })),
  });
  const artifactPath = await writeArtifact(workspace, 'storyboard', artifact);
  await writeStageCheckpoint(workspace, {
    stage: 'storyboard',
    status: 'completed',
    generatedAt: new Date().toISOString(),
    artifacts: {
      storyboard: artifactPath,
    },
    summary: 'Storyboard artifact created.',
    issues: [],
    nextAction: 'Create or attach scene assets.',
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.storyboard.written',
    payload: { artifactPath, sceneCount: artifact.scenes.length },
  });
  await updateProjectManifestState(workspace, {
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'completed',
  });

  process.stdout.write(`${JSON.stringify({ workspace, artifactPath, artifact }, null, 2)}\n`);
}

function parseAssetSpec(raw: string): {
  id: string;
  kind: 'image' | 'video' | 'audio' | 'subtitle' | 'other';
  path: string;
  sceneIndex?: number;
  backend?: string;
} {
  const [kindRaw, path, sceneIndexRaw, backend] = raw.split(':');
  if (!kindRaw || !path) {
    throw new Error(`Invalid --asset value: "${raw}". Expected kind:path[:sceneIndex][:backend]`);
  }
  const allowedKinds = new Set(['image', 'video', 'audio', 'subtitle', 'other']);
  const kind = allowedKinds.has(kindRaw) ? kindRaw as 'image' | 'video' | 'audio' | 'subtitle' | 'other' : 'other';
  const sceneIndex = sceneIndexRaw !== undefined && sceneIndexRaw !== '' ? Number(sceneIndexRaw) : undefined;
  return {
    id: `${kind}-${path}`,
    kind,
    path,
    ...(Number.isFinite(sceneIndex) ? { sceneIndex } : {}),
    ...(backend ? { backend } : {}),
  };
}

async function handleVideoAssets(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  const assetSpecs = parseRepeatableFlag(args, '--asset');
  if (!slug || assetSpecs.length === 0) {
    const missing: string[] = [];
    if (!slug) missing.push('--project');
    if (assetSpecs.length === 0) missing.push('--asset');
    throw new VclawError(
      'missing_required_flag',
      'video assets requires --project <slug> and at least one --asset <kind:path[:sceneIndex][:backend]>',
      { missing },
    );
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const workspace = await ensureProjectWorkspace(slug, root);
  const projectManifest = await readProjectManifest(workspace);
  const resolvedMode = projectManifest?.productionMode ?? 'storyboard';
  await assertStageReady(workspace, resolvedMode, 'assets');
  const artifact = {
    projectSlug: slug,
    assets: assetSpecs.map(parseAssetSpec),
  };
  const artifactPath = await writeArtifact(workspace, 'asset-manifest', artifact);
  await writeStageCheckpoint(workspace, {
    stage: 'assets',
    status: 'completed',
    generatedAt: new Date().toISOString(),
    artifacts: {
      'asset-manifest': artifactPath,
    },
    summary: 'Asset manifest created.',
    issues: [],
    nextAction: 'Run a review and record the verdict.',
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.asset-manifest.written',
    payload: { artifactPath, assetCount: artifact.assets.length },
  });
  await updateProjectManifestState(workspace, {
    currentStage: 'review',
    lastCompletedStage: 'assets',
    lastCheckpointStatus: 'completed',
  });
  process.stdout.write(`${JSON.stringify({ workspace, artifactPath, artifact }, null, 2)}\n`);
}

async function handleVideoReview(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  const verdict = parseFlagValue(args, '--verdict') as 'pass' | 'retry' | 'fail' | undefined;
  if (!slug || !verdict) {
    throw new Error('video review requires --project <slug> and --verdict pass|retry|fail');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const findings = parseRepeatableFlag(args, '--finding');
  const workspace = await ensureProjectWorkspace(slug, root);
  const projectManifest = await readProjectManifest(workspace);
  const resolvedMode = projectManifest?.productionMode ?? 'storyboard';
  await assertStageReady(workspace, resolvedMode, 'review');
  const artifact = createReviewReportArtifact({
    projectSlug: slug,
    verdict,
    findings,
    metrics: {
      publishReady: verdict === 'pass',
      nextAction: verdict === 'pass'
        ? 'Ready for publish handoff.'
        : 'Resolve review findings before publishing.',
    },
  });
  const artifactPath = await writeArtifact(workspace, 'review-report', artifact);
  await writeStageCheckpoint(workspace, {
    stage: 'review',
    status: verdict === 'pass' ? 'completed' : verdict === 'retry' ? 'retry-required' : 'failed',
    generatedAt: artifact.generatedAt,
    artifacts: {
      'review-report': artifactPath,
    },
    summary: `Review recorded with verdict: ${verdict}.`,
    issues: findings,
    nextAction: verdict === 'pass' ? 'Ready for publish handoff.' : 'Resolve review findings before publishing.',
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.review-report.written',
    recordedAt: artifact.generatedAt,
    payload: { artifactPath, verdict },
  });
  await updateProjectManifestState(workspace, {
    currentStage: verdict === 'pass' ? 'publish' : 'review',
    lastCompletedStage: verdict === 'pass' ? 'review' : 'assets',
    lastCheckpointStatus: verdict === 'pass' ? 'completed' : verdict === 'retry' ? 'retry-required' : 'failed',
  });
  process.stdout.write(`${JSON.stringify({ workspace, artifactPath, artifact }, null, 2)}\n`);
}

async function handleVideoPublish(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  const status = parseFlagValue(args, '--status') as 'ready' | 'published' | 'blocked' | undefined;
  if (!slug || !status) {
    throw new Error('video publish requires --project <slug> and --status ready|published|blocked');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const finalOutputPath = parseFlagValue(args, '--final-output');
  const notes = parseRepeatableFlag(args, '--note');
  const workspace = await ensureProjectWorkspace(slug, root);
  const projectManifest = await readProjectManifest(workspace);
  const resolvedMode = projectManifest?.productionMode ?? 'storyboard';
  await assertStageReady(workspace, resolvedMode, 'publish');
  const artifact = createPublishReportArtifact({
    projectSlug: slug,
    status,
    ...(finalOutputPath ? { finalOutputPath } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  });
  const artifactPath = await writeArtifact(workspace, 'publish-report', artifact);
  await writeStageCheckpoint(workspace, {
    stage: 'publish',
    status: status === 'blocked' ? 'failed' : 'completed',
    generatedAt: artifact.generatedAt,
    artifacts: {
      'publish-report': artifactPath,
    },
    summary: `Publish state recorded as ${status}.`,
    issues: status === 'blocked' ? notes : [],
    nextAction: status === 'blocked' ? 'Resolve publish blocker.' : undefined,
  });
  await appendProjectEvent(workspace, {
    type: 'artifact.publish-report.written',
    recordedAt: artifact.generatedAt,
    payload: { artifactPath, status, finalOutputPath },
  });
  await updateProjectManifestState(workspace, {
    currentStage: status === 'blocked' ? 'publish' : null,
    lastCompletedStage: status === 'blocked' ? 'review' : 'publish',
    lastCheckpointStatus: status === 'blocked' ? 'failed' : 'completed',
  });
  process.stdout.write(`${JSON.stringify({ workspace, artifactPath, artifact }, null, 2)}\n`);
}

async function handleVideoStatus(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new Error('video status requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const report = await buildProjectStatusReport(slug, root, mode);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function handleVideoList(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const projects = await listProjects(root);
  process.stdout.write(`${JSON.stringify({ root, projects }, null, 2)}\n`);
}

async function handleVideoDoctorProject(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new Error('video doctor-project requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const report = await doctorProject(slug, root, mode);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function handleVideoDoctorPortfolio(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const report = await doctorPortfolio(root, mode);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function handleVideoExportObsidian(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  if (!slug) {
    throw new Error('video export-obsidian requires --project <slug>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const outputDir = parseFlagValue(args, '--output-dir');
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const result = await exportProjectToObsidian(slug, {
    root,
    outputDir,
    productionMode: mode,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoIndex(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const output = parseFlagValue(args, '--output');
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const index = await buildProjectIndex(root, mode);
  const outputPath = await writeProjectIndex(index, output);
  process.stdout.write(`${JSON.stringify({ outputPath, index }, null, 2)}\n`);
}

async function handleVideoMetrics(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const metrics = await buildPortfolioMetrics(root, mode);
  process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
}

async function handleVideoWorkload(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const workload = await buildOwnerWorkloadReport(root, mode);
  process.stdout.write(`${JSON.stringify(workload, null, 2)}\n`);
}

async function handleVideoNextActions(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const nextActions = await buildNextActions(root, mode);
  process.stdout.write(`${JSON.stringify(nextActions, null, 2)}\n`);
}

async function handleVideoDependencies(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const dependencies = await buildDependencyReport(root, mode);
  process.stdout.write(`${JSON.stringify(dependencies, null, 2)}\n`);
}

async function handleVideoReport(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const report = await buildPortfolioReport(root, mode);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

async function handleVideoReportSnapshot(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const result = await writePortfolioReportSnapshot(root, mode);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoReportHistory(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const snapshots = await listPortfolioReportSnapshots(root);
  process.stdout.write(`${JSON.stringify({ root, snapshots }, null, 2)}\n`);
}

async function handleVideoReportDiff(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const fromPath = parseFlagValue(args, '--from');
  const toPath = parseFlagValue(args, '--to');
  const diff = await buildPortfolioReportDiff(root, {
    ...(fromPath ? { fromPath } : {}),
    ...(toPath ? { toPath } : {}),
  });
  process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
}

async function handleVideoTrends(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const trends = await buildPortfolioTrendReport(root);
  process.stdout.write(`${JSON.stringify(trends, null, 2)}\n`);
}

async function handleVideoExportCsv(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const outputDir = parseFlagValue(args, '--output-dir');
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const result = await exportPortfolioCsv(root, outputDir, mode);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoSyncObsidian(args: string[]): Promise<void> {
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const outputDir = parseFlagValue(args, '--output-dir');
  const mode = (parseFlagValue(args, '--mode') ?? 'storyboard') as VideoProductionMode;
  const result = await syncObsidianVault({
    root,
    outputDir,
    productionMode: mode,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoScaffoldObsidianVault(args: string[]): Promise<void> {
  const outputDir = parseFlagValue(args, '--output-dir') ?? join(process.cwd(), 'ops', 'obsidian');
  const result = await scaffoldObsidianVault(outputDir);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function handleVideoArtifactHistory(args: string[]): Promise<void> {
  const slug = parseFlagValue(args, '--project');
  const artifact = parseFlagValue(args, '--artifact');
  if (!slug || !artifact) {
    throw new Error('video artifact-history requires --project <slug> and --artifact <name>');
  }
  const root = parseFlagValue(args, '--root') ?? process.cwd();
  const result = await buildArtifactHistoryReport(
    slug,
    artifact as Parameters<typeof buildArtifactHistoryReport>[1],
    root,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

// v3 noun-verb consistency. Both forms dispatch to the same handler.
// The kebab form is treated as the canonical name internally; the
// noun-verb form is the user-facing v3 preference. `vclaw schema --json`
// lists the canonical name; aliases are documented in CLI_REFERENCE.md.
const NOUN_VERB_ALIASES: Record<string, string> = {
  // user types -> canonical
  'export csv': 'export-csv',
  'character add': 'character-add',
  'character list': 'character-list',
  'character show': 'character-show',
  'character auto-create': 'character-auto-create',
  'character import-library': 'character-import-library',
  'character consistency': 'character-consistency',
  'reference-sheet add': 'reference-sheet-add',
  'reference-sheet list': 'reference-sheet-list',
  'reference-sheet show': 'reference-sheet-show',
  'reference-sheet bind': 'reference-sheet-bind',
  'reference-sheet validate': 'reference-sheet-validate',
  'candidates list': 'candidates-list',
  'candidates show': 'candidates-show',
  'storyboard review': 'storyboard-review',
  'storyboard still-add': 'storyboard-still-add',
  'review ui': 'review-ui',
  'review autopilot': 'review-autopilot',
  'execute status': 'execute-status',
  'execute cancel': 'execute-cancel',
  'doctor project': 'doctor-project',
  'doctor portfolio': 'doctor-portfolio',
  'export obsidian': 'export-obsidian',
  'sync obsidian': 'sync-obsidian',
  'verify env': 'verify-env',
  'verify final': 'verify-final',
};

function resolveSubcommand(args: string[]): { canonical: string; rest: string[] } {
  if (args.length >= 2) {
    const twoWord = `${args[0]} ${args[1]}`;
    if (NOUN_VERB_ALIASES[twoWord]) {
      return { canonical: NOUN_VERB_ALIASES[twoWord], rest: args.slice(2) };
    }
  }
  return { canonical: args[0] ?? '', rest: args.slice(1) };
}

export async function main(): Promise<void> {
  const [, , command, ...videoArgs] = process.argv;

  if (!command) {
    printCompatibilityNotice();
    printHelp();
    return;
  }

  printCompatibilityNotice();

  if (command === 'schema') {
    const { buildSchemaDump } = await import('../video/cli-schema.js');
    writeOutput(buildSchemaDump(), { json: true });
    return;
  }

  // Resolve noun-verb aliases for `video <noun> <verb>` -> `video <noun-verb>`.
  // Single-word subcommands (e.g. `video init`) fall through unchanged via
  // the resolver's else branch (canonical=args[0], rest=args.slice(1)).
  const resolved = command === 'video'
    ? resolveSubcommand(videoArgs)
    : { canonical: videoArgs[0] ?? '', rest: videoArgs.slice(1) };
  const subcommand: string | undefined = resolved.canonical || undefined;
  const rest: string[] = resolved.rest;

  if (command === 'video' && subcommand === 'providers') {
    const workspaceRoot = parseFlagValue(rest, '--workspace-root');
    const report = buildProviderStatusReport({ workspaceRoot });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  if (command === 'video' && subcommand === 'init') {
    await handleVideoInit(rest);
    return;
  }

  if (command === 'video' && subcommand === 'create') {
    await handleVideoCreate(rest);
    return;
  }
  if (command === 'video' && subcommand === 'auto') {
    await handleVideoAuto(rest);
    return;
  }
  if (command === 'video' && subcommand === 'iterate') {
    await handleVideoIterate(rest);
    return;
  }
  if (command === 'video' && subcommand === 'run-pipeline') {
    await handleVideoRunPipeline(rest);
    return;
  }
  if (command === 'video' && subcommand === 'approve') {
    await handleVideoApprove(rest);
    return;
  }

  if (command === 'video' && subcommand === 'set-meta') {
    await handleVideoSetMeta(rest);
    return;
  }

  if (command === 'video' && subcommand === 'set-execution-profile') {
    await handleVideoSetExecutionProfile(rest);
    return;
  }
  if (command === 'video' && subcommand === 'cost-estimate') {
    await handleVideoCostEstimate(rest);
    return;
  }
  if (command === 'video' && subcommand === 'remix-narrated') {
    await handleVideoRemixNarrated(rest);
    return;
  }
  if (command === 'video' && subcommand === 'list-library') {
    await handleVideoListLibrary(rest);
    return;
  }
  if (command === 'video' && subcommand === 'find-library') {
    await handleVideoFindLibrary(rest);
    return;
  }
  if (command === 'video' && subcommand === 'verify-final') {
    await handleVideoVerifyFinal(rest);
    return;
  }
  if (command === 'video' && subcommand === 'make-vertical') {
    await handleVideoMakeVertical(rest);
    return;
  }
  if (command === 'video' && subcommand === 'make-square') {
    await handleVideoMakeSquare(rest);
    return;
  }
  if (command === 'video' && subcommand === 'make-loop') {
    await handleVideoMakeLoop(rest);
    return;
  }
  if (command === 'video' && subcommand === 'thumbnail') {
    await handleVideoThumbnail(rest);
    return;
  }
  if (command === 'video' && subcommand === 'burn-subtitles') {
    await handleVideoBurnSubtitles(rest);
    return;
  }
  if (command === 'video' && subcommand === 'archive-project') {
    await handleVideoArchiveProject(rest);
    return;
  }
  if (command === 'video' && subcommand === 'verify-env') {
    await handleVideoVerifyEnv(rest);
    return;
  }

  if (command === 'video' && subcommand === 'character-add') {
    await handleVideoCharacterAdd(rest);
    return;
  }
  if (command === 'video' && subcommand === 'character-auto-create') {
    await handleVideoCharacterAutoCreate(rest);
    return;
  }
  if (command === 'video' && subcommand === 'character-import-library') {
    await handleVideoCharacterImportLibrary(rest);
    return;
  }

  if (command === 'video' && subcommand === 'character-list') {
    await handleVideoCharacterList(rest);
    return;
  }

  if (command === 'video' && subcommand === 'character-show') {
    await handleVideoCharacterShow(rest);
    return;
  }
  if (command === 'video' && subcommand === 'character-consistency') {
    await handleVideoCharacterConsistency(rest);
    return;
  }

  if (command === 'video' && subcommand === 'reference-sheet-add') {
    await handleVideoReferenceSheetAdd(rest);
    return;
  }
  if (command === 'video' && subcommand === 'reference-sheet-list') {
    await handleVideoReferenceSheetList(rest);
    return;
  }
  if (command === 'video' && subcommand === 'reference-sheet-show') {
    await handleVideoReferenceSheetShow(rest);
    return;
  }
  if (command === 'video' && subcommand === 'reference-sheet-bind') {
    await handleVideoReferenceSheetBind(rest);
    return;
  }
  if (command === 'video' && subcommand === 'reference-sheet-validate') {
    await handleVideoReferenceSheetValidate(rest);
    return;
  }

  if (command === 'video' && subcommand === 'candidates-list') {
    await handleVideoCandidatesList(rest);
    return;
  }
  if (command === 'video' && subcommand === 'candidates-show') {
    await handleVideoCandidatesShow(rest);
    return;
  }
  if (command === 'video' && subcommand === 'storyboard-still-add') {
    await handleVideoStoryboardStillAdd(rest);
    return;
  }
  if (command === 'video' && subcommand === 'select-candidate') {
    await handleVideoSelectCandidate(rest);
    return;
  }
  if (command === 'video' && subcommand === 'reject-candidate') {
    await handleVideoRejectCandidate(rest);
    return;
  }
  if (command === 'video' && subcommand === 'reroll-scene') {
    await handleVideoRerollScene(rest);
    return;
  }
  if (command === 'video' && subcommand === 'chain-from') {
    await handleVideoChainFrom(rest);
    return;
  }
  if (command === 'video' && subcommand === 'unchain') {
    await handleVideoUnchain(rest);
    return;
  }
  if (command === 'video' && subcommand === 'candidates-migrate-from-assets') {
    await handleVideoCandidatesMigrateFromAssets(rest);
    return;
  }

  if (command === 'video' && subcommand === 'playbook-list') {
    await handleVideoPlaybookList(rest);
    return;
  }

  if (command === 'video' && subcommand === 'playbook-show') {
    await handleVideoPlaybookShow(rest);
    return;
  }

  if (command === 'video' && subcommand === 'library') {
    await handleVideoLibrary(rest);
    return;
  }

  if (command === 'video' && subcommand === 'prompt-lib-list') {
    await handleVideoPromptLibList();
    return;
  }

  if (command === 'video' && subcommand === 'prompt-lib-show') {
    await handleVideoPromptLibShow(rest);
    return;
  }

  if (command === 'video' && subcommand === 'import-legacy') {
    await handleVideoImportLegacy(rest);
    return;
  }

  if (command === 'video' && subcommand === 'template-save') {
    await handleVideoTemplateSave(rest);
    return;
  }

  if (command === 'video' && subcommand === 'template-create') {
    await handleVideoTemplateSave(rest);
    return;
  }

  if (command === 'video' && subcommand === 'template-list') {
    await handleVideoTemplateList(rest);
    return;
  }

  if (command === 'video' && subcommand === 'template-show') {
    await handleVideoTemplateShow(rest);
    return;
  }

  if (command === 'video' && subcommand === 'template-validate') {
    await handleVideoTemplateValidate(rest);
    return;
  }

  if (command === 'video' && subcommand === 'storyboard-template-list') {
    await handleVideoStoryboardTemplateList();
    return;
  }

  if (command === 'video' && subcommand === 'storyboard-template-show') {
    await handleVideoStoryboardTemplateShow(rest);
    return;
  }

  if (command === 'video' && subcommand === 'clone-plan') {
    await handleVideoClonePlan(rest);
    return;
  }

  if (command === 'video' && subcommand === 'clone-init') {
    await handleVideoCloneInit(rest);
    return;
  }

  if (command === 'video' && subcommand === 'clone-execute') {
    await handleVideoCloneExecute(rest);
    return;
  }

  if (command === 'video' && subcommand === 'clone-ad') {
    await handleVideoCloneExecute(rest);
    return;
  }

  if (command === 'video' && subcommand === 'storyboard-from-clone') {
    await handleVideoStoryboardFromClone(rest);
    return;
  }

  if (command === 'video' && subcommand === 'readiness') {
    await handleVideoReadiness(rest);
    return;
  }

  if (command === 'video' && subcommand === 'director-preflight') {
    await handleVideoDirectorPreflight(rest);
    return;
  }

  if (command === 'video' && subcommand === 'storyboard-review') {
    await handleVideoStoryboardReview(rest);
    return;
  }

  if (command === 'video' && subcommand === 'review-ui') {
    await handleVideoReviewUi(rest);
    return;
  }

  if (command === 'video' && subcommand === 'review-autopilot') {
    await handleVideoReviewAutopilot(rest);
    return;
  }

  if (command === 'video' && subcommand === 'preflight') {
    await handleVideoDirectorPreflight(rest);
    return;
  }

  if (command === 'video' && subcommand === 'execution-plan') {
    await handleVideoExecutionPlan(rest);
    return;
  }

  if (command === 'video' && subcommand === 'plan') {
    await handleVideoExecutionPlan(rest);
    return;
  }

  if (command === 'video' && subcommand === 'execute') {
    await handleVideoExecute(rest);
    return;
  }

  if (command === 'video' && subcommand === 'produce') {
    await handleVideoExecute(rest);
    return;
  }
  if (command === 'video' && subcommand === 'execute-status') {
    await handleVideoExecuteStatus(rest);
    return;
  }
  if (command === 'video' && subcommand === 'execute-cancel') {
    await handleVideoExecuteCancel(rest);
    return;
  }

  if (command === 'video' && subcommand === 'list') {
    await handleVideoList(rest);
    return;
  }

  if (command === 'video' && subcommand === 'index') {
    await handleVideoIndex(rest);
    return;
  }

  if (command === 'video' && subcommand === 'metrics') {
    await handleVideoMetrics(rest);
    return;
  }

  if (command === 'video' && subcommand === 'workload') {
    await handleVideoWorkload(rest);
    return;
  }

  if (command === 'video' && subcommand === 'next-actions') {
    await handleVideoNextActions(rest);
    return;
  }

  if (command === 'video' && subcommand === 'dependencies') {
    await handleVideoDependencies(rest);
    return;
  }

  if (command === 'video' && subcommand === 'report') {
    await handleVideoReport(rest);
    return;
  }

  if (command === 'video' && subcommand === 'report-snapshot') {
    await handleVideoReportSnapshot(rest);
    return;
  }

  if (command === 'video' && subcommand === 'report-history') {
    await handleVideoReportHistory(rest);
    return;
  }

  if (command === 'video' && subcommand === 'report-diff') {
    await handleVideoReportDiff(rest);
    return;
  }

  if (command === 'video' && subcommand === 'trends') {
    await handleVideoTrends(rest);
    return;
  }

  if (command === 'video' && subcommand === 'export-csv') {
    await handleVideoExportCsv(rest);
    return;
  }

  if (command === 'video' && subcommand === 'analyze') {
    await handleVideoAnalyze(rest);
    return;
  }

  if (command === 'video' && subcommand === 'analyze-template') {
    await handleVideoAnalyze(rest);
    return;
  }

  if (command === 'video' && subcommand === 'brief') {
    await handleVideoBrief(rest);
    return;
  }

  if (command === 'video' && subcommand === 'storyboard') {
    await handleVideoStoryboard(rest);
    return;
  }

  if (command === 'video' && subcommand === 'assets') {
    await handleVideoAssets(rest);
    return;
  }

  if (command === 'video' && subcommand === 'review') {
    await handleVideoReview(rest);
    return;
  }

  if (command === 'video' && subcommand === 'publish') {
    await handleVideoPublish(rest);
    return;
  }

  if (command === 'video' && subcommand === 'status') {
    await handleVideoStatus(rest);
    return;
  }

  if (command === 'video' && subcommand === 'doctor-project') {
    await handleVideoDoctorProject(rest);
    return;
  }

  if (command === 'video' && subcommand === 'doctor-portfolio') {
    await handleVideoDoctorPortfolio(rest);
    return;
  }

  if (command === 'video' && subcommand === 'artifact-history') {
    await handleVideoArtifactHistory(rest);
    return;
  }

  if (command === 'video' && subcommand === 'export-obsidian') {
    await handleVideoExportObsidian(rest);
    return;
  }

  if (command === 'video' && subcommand === 'sync-obsidian') {
    await handleVideoSyncObsidian(rest);
    return;
  }

  if (command === 'video' && subcommand === 'scaffold-obsidian-vault') {
    await handleVideoScaffoldObsidianVault(rest);
    return;
  }

  if (command === 'veo') {
    const { spawnVeo } = await import('../video/veo-subprocess.js');
    const verb = videoArgs[0];
    if (!verb) {
      throw new VclawError(
        'missing_required_flag',
        'vclaw veo requires a verb. Try: status, list, history, resume, reset, cancel, useapi:accounts, useapi:health.',
        { flag: '<verb>' },
      );
    }
    const veoArgs = [verb, ...videoArgs.slice(1)];
    const result = await spawnVeo(veoArgs);
    process.exit(result.exitCode);
  }

  const attemptedSubcommand = subcommand
    ? `${command} ${subcommand}`
    : command;
  throw new VclawError(
    'unknown_subcommand',
    `Unknown subcommand: ${attemptedSubcommand}. Run \`vclaw schema --json\` for the full command list.`,
    { command, subcommand: subcommand ?? null },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    exitWith(err);
  }
}
