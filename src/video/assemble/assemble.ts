/**
 * Assemble-stage orchestrator (sub-slice 3i) — the capstone that ties the
 * post-execution assembly pipeline together behind `vclaw video assemble`.
 *
 * Runs the building blocks shipped in 3b–3h IN ORDER and collects an
 * `AssembleManifestEntry[]`:
 *   1. (optional) extractPdfSlides       — PDF deck -> slide images        (3c)
 *   2. (optional) generateTitleCard      — branded title card             (3d)
 *   3. animateSlide per slide            — per-slide video segments        (3e)
 *   4. generateTts per scene             — per-scene narration audio       (3b)
 *   5. (optional) generateMusic          — background music bed            (3f)
 *   6. stitch                            — final MP4                       (3h)
 *   7. (advisory) qa-* checks            — collected into warnings         (3g)
 *
 * DRY-RUN is the tested surface. `assembleProject({ dryRun: true })` PLANS the
 * whole pipeline — every FFmpeg command + provider call is recorded into the
 * manifest/events WITHOUT executing anything or needing API keys. Real
 * execution (ffmpeg spawns + provider keys) is a HUMAN integration checkpoint,
 * explicitly out of scope for the unit tests (same boundary as 3e/3h).
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import type { VideoProjectWorkspace } from '../workspace.js';
import { artifactPathFor, writeArtifact } from '../artifact-store.js';
import { createAssembleReportArtifact, type AssembleReportArtifact } from '../artifacts.js';
import type {
  AssembleInput,
  AssembleManifestEntry,
  AssembleResult,
} from './types.js';
import { extractPdfSlides } from './pdf.js';
import { generateTitleCard } from './title-card.js';
import { animateSlide, alignDurationToFrame } from './animate-slides.js';
import { generateTts } from './tts.js';
import { generateMusic } from './music.js';
import { stitch, type StitchInput, type ConcatStrategy } from './stitch.js';
import { lintDialogue } from './qa-dialogue-lint.js';
import { checkNarration } from './qa-narration.js';
import { checkImageFilter } from './qa-image-filter.js';

/** Default per-scene narration duration (sec) used when no probe is available. */
const DEFAULT_SCENE_DURATION_SEC = 5;

/** Storyboard scene shape (subset we consume here). */
interface StoryboardScene {
  sceneIndex: number;
  description: string;
  dialogue?: string;
  durationSeconds?: number;
  scenePrompt?: { imagePrompt?: string };
}

interface StoryboardArtifactShape {
  projectSlug?: string;
  scenes?: StoryboardScene[];
}

/**
 * The assemble-relevant knobs read from the brand-profile.json. The shipped
 * brand-profile.schema.json is presenter-routing focused (presenterName,
 * characterId, voiceId, intro/outro assets …); the assemble stage reads what it
 * needs from it loosely and falls back to defaults for anything absent. Extra
 * assemble fields (deck/music/concat) are honored if present without failing
 * brand-profile validation, since they live alongside the required routing
 * fields.
 */
interface BrandProfileForAssemble {
  presenterName?: string;
  voiceId?: string;
  introAsset?: string;
  outroAsset?: string;
  /** Optional PDF deck to rasterize into slides. */
  deckPdf?: string;
  /** Optional title-card config. */
  titleCard?: { title: string; subtitle?: string; background?: string };
  /** Optional background-music config (the nex-brand knob). */
  music?: { enabled?: boolean; prompt?: string; durationSec?: number; volume?: number };
  /** Concat strategy override (bunty -> demuxer/auto, nex -> filter). */
  concatStrategy?: ConcatStrategy;
  /** Intro/outro pre-encoded segment paths, if the brand provides them. */
  introSegments?: string[];
  outroSegments?: string[];
}

async function loadStoryboard(
  workspace: VideoProjectWorkspace,
): Promise<StoryboardScene[]> {
  const storyboardPath = artifactPathFor(workspace, 'storyboard');
  if (!existsSync(storyboardPath)) return [];
  const parsed = JSON.parse(await readFile(storyboardPath, 'utf-8')) as StoryboardArtifactShape;
  const scenes = parsed.scenes ?? [];
  return [...scenes].sort((a, b) => a.sceneIndex - b.sceneIndex);
}

async function loadBrandProfile(
  brandProfilePath?: string,
): Promise<BrandProfileForAssemble | undefined> {
  if (!brandProfilePath) return undefined;
  if (!existsSync(brandProfilePath)) return undefined;
  return JSON.parse(await readFile(brandProfilePath, 'utf-8')) as BrandProfileForAssemble;
}

/** Narration text for a scene: explicit dialogue, else the description. */
function narrationFor(scene: StoryboardScene): string {
  return (scene.dialogue ?? scene.description ?? '').trim();
}

/**
 * Orchestrate the assemble pipeline. Returns an `AssembleResult` whose
 * `manifest` records each produced (or planned, on dry-run) asset in pipeline
 * order, `events` is a human-readable step log, and `warnings` collects the
 * advisory QA findings.
 *
 * On `dryRun`, every step is PLANNED (manifest entries + events) but nothing is
 * generated and no API key is required.
 */
export async function assembleProject(input: AssembleInput): Promise<AssembleResult> {
  const { workspace, brandProfilePath, ffmpegBin } = input;
  const dryRun = input.dryRun ?? false;

  const manifest: AssembleManifestEntry[] = [];
  const events: string[] = [];
  const warnings: string[] = [];

  const scenes = await loadStoryboard(workspace);
  const brand = await loadBrandProfile(brandProfilePath);

  const assembleDir = join(workspace.projectDir, 'assemble');
  const slidesDir = join(assembleDir, 'slides');
  const audioDir = join(assembleDir, 'audio');
  const segmentsDir = join(assembleDir, 'segments');
  const outputPath = join(workspace.projectDir, 'outputs', 'final.mp4');

  // --- Step 1: PDF slide extraction (optional) -------------------------------
  let slidePaths: string[] = [];
  if (brand?.deckPdf) {
    const pdfPath = resolvePath(workspace.projectDir, brand.deckPdf);
    events.push(`pdf: extract slides from ${brand.deckPdf}`);
    if (dryRun) {
      // Plan one slide per scene as the dry-run estimate (no PDF parse).
      slidePaths = scenes.map((s) => join(slidesDir, `slide_${String(s.sceneIndex).padStart(3, '0')}.png`));
    } else {
      const pdf = await extractPdfSlides({ pdfPath, outputDir: slidesDir });
      slidePaths = pdf.pages.map((p) => p.path);
    }
  } else {
    // No deck: each scene's slide is its produced image asset (placeholder path).
    slidePaths = scenes.map((s) => join(slidesDir, `slide_${String(s.sceneIndex).padStart(3, '0')}.png`));
  }

  // --- Step 2: title card (optional) -----------------------------------------
  if (brand?.titleCard) {
    const titleCardPath = join(assembleDir, 'title-card.png');
    events.push(`title-card: "${brand.titleCard.title}"`);
    const tc = await generateTitleCard({
      title: brand.titleCard.title,
      subtitle: brand.titleCard.subtitle,
      background: brand.titleCard.background,
      outputPath: titleCardPath,
      dryRun,
    });
    manifest.push({
      kind: 'title-card',
      path: dryRun ? titleCardPath : tc.path,
      durationMs: 0,
      sizeBytes: 0,
      generator: 'assemble/title-card.ts',
    });
  }

  // --- Step 4 (computed first): per-scene narration (TTS) --------------------
  // TTS is needed to drive the per-slide segment durations in step 3, so we
  // plan it before animation even though the canonical pipeline lists it after.
  const ttsSegments = scenes.map((s) => ({ sceneIndex: s.sceneIndex, text: narrationFor(s) }));
  if (ttsSegments.length > 0 && (brand?.voiceId || dryRun)) {
    events.push(`tts: ${ttsSegments.length} scene narration(s)`);
    const tts = await generateTts({
      segments: ttsSegments,
      voiceId: brand?.voiceId ?? 'dry-run-voice',
      outputDir: audioDir,
      dryRun,
    });
    for (const scene of tts.scenes) {
      manifest.push({
        kind: 'narration',
        path: scene.path,
        durationMs: 0,
        sceneIndex: scene.sceneIndex,
        sizeBytes: scene.sizeBytes,
        generator: 'assemble/tts.ts',
      });
    }
    // Real runs also surface tts.manifest entries (already shaped); merge any
    // not already represented (defensive — dry-run returns an empty manifest).
  } else if (ttsSegments.length > 0) {
    warnings.push('tts skipped: no voiceId in brand profile (real run requires one).');
  }

  // --- Step 3: per-slide animation -> segments -------------------------------
  const segmentPaths: string[] = [];
  for (const scene of scenes) {
    const slidePath = slidePaths[scene.sceneIndex] ?? slidePaths[scenes.indexOf(scene)] ?? '';
    const ttsPath = join(audioDir, `scene_${String(scene.sceneIndex).padStart(3, '0')}.mp3`);
    const segmentPath = join(segmentsDir, `seg_slide_${String(scene.sceneIndex).padStart(3, '0')}.mp4`);
    const durationSec = scene.durationSeconds ?? DEFAULT_SCENE_DURATION_SEC;
    events.push(`animate: scene ${scene.sceneIndex} -> ${segmentPath}`);
    if (dryRun) {
      // Plan the segment without spawning ffmpeg.
      segmentPaths.push(segmentPath);
      manifest.push({
        kind: 'slide-animation',
        path: segmentPath,
        durationMs: Math.round(alignDurationToFrame(durationSec) * 1000),
        sceneIndex: scene.sceneIndex,
        sizeBytes: 0,
        generator: 'assemble/animate-slides.ts',
      });
    } else {
      const seg = await animateSlide(
        {
          slidePath,
          ttsPath,
          outputPath: segmentPath,
          durationSec,
          slideNum: scenes.indexOf(scene) + 1,
          numSlides: scenes.length,
        },
        { ffmpegBin },
      );
      segmentPaths.push(seg.path);
      manifest.push({
        kind: 'slide-animation',
        path: seg.path,
        durationMs: seg.durationMs,
        sceneIndex: scene.sceneIndex,
        sizeBytes: 0,
        generator: 'assemble/animate-slides.ts',
      });
    }
  }

  // --- Step 5: background music (optional) -----------------------------------
  let musicPath: string | undefined;
  if (brand?.music?.enabled) {
    musicPath = join(assembleDir, 'music.mp3');
    const prompt = brand.music.prompt ?? 'Soft ambient background bed, instrumental.';
    events.push('music: generate background bed');
    const music = await generateMusic({
      prompt,
      durationSec: brand.music.durationSec,
      outputPath: musicPath,
      dryRun,
    });
    manifest.push({
      kind: 'music',
      path: music.path,
      durationMs: music.durationMs,
      sizeBytes: 0,
      generator: 'assemble/music.ts',
    });
  }

  // --- Step 6: stitch -> final MP4 -------------------------------------------
  let finalOutputPath = outputPath;
  if (segmentPaths.length > 0) {
    const stitchInput: StitchInput = {
      segments: segmentPaths,
      intro: brand?.introSegments,
      outro: brand?.outroSegments,
      outputPath,
      concatStrategy: brand?.concatStrategy,
      ...(musicPath
        ? { music: { trackPath: musicPath, volume: brand?.music?.volume } }
        : {}),
    };
    events.push(
      `stitch: ${segmentPaths.length} segment(s) -> ${outputPath}` +
        (musicPath ? ' (+music)' : ''),
    );
    const stitched = await stitch(stitchInput, { dryRun, ffmpegBin });
    finalOutputPath = stitched.outputPath;
    for (const step of stitched.plan) {
      events.push(`stitch.plan: ${step.kind} -> ${step.outputPath}`);
    }
    manifest.push({
      kind: 'final-video',
      path: stitched.outputPath,
      durationMs: stitched.durationMs,
      sizeBytes: 0,
      generator: 'assemble/stitch.ts',
    });
  } else {
    warnings.push('stitch skipped: no slide segments (empty storyboard).');
  }

  // --- Step 7: advisory QA ---------------------------------------------------
  if (scenes.length > 0) {
    const dialogueResult = lintDialogue({
      segments: scenes.map((s) => ({ sceneIndex: s.sceneIndex, text: narrationFor(s) })),
    });
    for (const w of dialogueResult.warnings) {
      warnings.push(`qa.dialogue[scene ${w.sceneIndex}/${w.rule}]: ${w.message}`);
    }

    const narrationResult = checkNarration({
      scenes: scenes.map((s) => ({ sceneIndex: s.sceneIndex, narration: narrationFor(s) })),
      slideCount: slidePaths.length || undefined,
    });
    for (const w of narrationResult.warnings) {
      warnings.push(`qa.narration[scene ${w.sceneIndex}/${w.rule}]: ${w.message}`);
    }

    const imageFilterResult = checkImageFilter({
      candidates: scenes
        .filter((s) => s.scenePrompt?.imagePrompt)
        .map((s) => ({ sceneIndex: s.sceneIndex, prompt: s.scenePrompt!.imagePrompt! })),
    });
    for (const w of imageFilterResult.warnings) {
      warnings.push(`qa.image-filter[scene ${w.sceneIndex}/${w.verdict}]: ${w.message}`);
    }
  }

  const status: AssembleResult['status'] = dryRun
    ? 'dry-run'
    : warnings.length > 0
      ? 'partial'
      : 'complete';

  return {
    status,
    outputPath: finalOutputPath,
    manifest,
    events,
    warnings,
  };
}

/**
 * Persist an `assemble-report.json` artifact for a completed (or dry-run)
 * assemble pass via the TYPED `writeArtifact` helper (so the artifact is no
 * longer an "alternate writer" — it's schema-covered). Validates against
 * schemas/video/artifacts/assemble-report.schema.json.
 */
export async function writeAssembleReport(
  workspace: VideoProjectWorkspace,
  result: AssembleResult,
  brandProfilePath?: string,
): Promise<{ artifactPath: string; report: AssembleReportArtifact }> {
  const report = createAssembleReportArtifact({
    projectSlug: workspace.slug,
    status: result.status,
    brandProfile: brandProfilePath ?? null,
    outputPath: result.outputPath,
    manifest: result.manifest.map((entry) => ({
      kind: entry.kind,
      path: entry.path,
      durationMs: entry.durationMs,
      ...(entry.sceneIndex !== undefined ? { sceneIndex: entry.sceneIndex } : {}),
      sizeBytes: entry.sizeBytes,
      generator: entry.generator,
    })),
    warnings: result.warnings,
    events: result.events,
  });
  const artifactPath = await writeArtifact(workspace, 'assemble-report', report);
  return { artifactPath, report };
}
