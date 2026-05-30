import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { artifactPathFor, writeArtifact } from './artifact-store.js';
import {
  audioMix,
  beats,
  captureRealismBlock,
  cameraSpec,
  backgroundPlate,
  gradeSpec,
  lightingSpec,
  musicSyncLine,
  orbitGrammar,
  type Beat,
  type CameraMove,
  type CaptureRealismOpts,
  type HazeDensity,
  type PlateKind,
  type DetailLevel,
} from './cinematography.js';
import type { AssetManifestArtifact, BriefArtifact, StoryboardArtifact } from './artifacts.js';
import {
  referenceBuildOrder,
  resolveCategory,
  type CategoryDescriptor,
  type ReferenceBuildStep,
} from './category-registry.js';
import {
  crossFrameBlock,
  frameMapBlock,
  lastFrameBlock,
  subjectLockBlock,
  POSITIONAL_BINDING,
  type FrameMapEntry,
  type SubjectLockEntry,
} from './seedance-blocks.js';
import { listCharacterProfiles, type CharacterProfile } from './characters.js';
import { readProductReferences } from './product-references.js';
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import type { ReferenceSheet, ReferenceSheetsArtifact } from './types.js';
import { ensureProjectWorkspace, type VideoProjectWorkspace } from './workspace.js';

/**
 * Two-phase gate for the generation function (E5). The intended workflow is
 * (1) lock the storyboard/panel layout + camera language, then (2) generate the
 * heavy video-generation packets. `phase` selects which slice to return:
 *   - omitted (default) → full result, byte-identical to today (no behavior change).
 *   - `'storyboard'`    → storyboard-only: `seedancePackets` is gated to `[]`; the
 *                         storyboard/camera-language portion (referenceMap,
 *                         characterSheetPrompts, storyboardGridPrompt) is kept.
 *   - `'video'`         → full video packets, equivalent to the default.
 */
export type FilmmakingPhase = 'storyboard' | 'video';

export type FilmmakingPromptVariant =
  | 'character-sheet'
  | 'storyboard-grid'
  | 'text-driven'
  | 'storyboard-grid-reference'
  | 'character-sheets-plus-storyboard-grid';

export interface FilmmakingReferenceSlot {
  slot: string;
  role: 'character-sheet' | 'storyboard-grid' | 'start-frame' | 'end-frame' | 'reference-image' | 'background-plate';
  label: string;
  path?: string;
  characterName?: string;
  sceneIndex?: number;
  status: 'ready' | 'pending';
}

export interface FilmmakingCharacterSheetPrompt {
  characterName: string;
  mode: 'reference-image' | 'description-only';
  referenceSlots: string[];
  promptText: string;
}

export interface FilmmakingStoryboardPanel {
  panel: number;
  position: string;
  timecode: string;
  beat: string;
  cam: string;
  move: string;
  mood: string;
}

export interface FilmmakingStoryboardGridPrompt {
  variant: 'storyboard-grid';
  panelCount: number;
  rows: number;
  cols: number;
  promptText: string;
  panels: FilmmakingStoryboardPanel[];
}

export interface FilmmakingSeedancePacket {
  sceneIndex: number;
  variant: Extract<
    FilmmakingPromptVariant,
    'text-driven' | 'storyboard-grid-reference' | 'character-sheets-plus-storyboard-grid'
  >;
  durationSeconds: number;
  references: FilmmakingReferenceSlot[];
  promptText: string;
  warnings: string[];
}

export interface FilmmakingPromptIssue {
  code:
    | 'character-description-missing'
    | 'character-description-long'
    | 'storyboard-missing'
    | 'storyboard-grid-pending'
    | 'reference-slot-pending'
    | 'seedance-music-default'
    | 'seedance-block-order';
  severity: 'warning' | 'error';
  message: string;
  path?: string;
}

export interface FilmmakingPromptsArtifact {
  schemaVersion: 1;
  projectSlug: string;
  generatedAt: string;
  sourceSkill: 'ai-filmmaking';
  durationDefaultSeconds: number;
  referenceMap: FilmmakingReferenceSlot[];
  characterSheetPrompts: FilmmakingCharacterSheetPrompt[];
  storyboardGridPrompt: FilmmakingStoryboardGridPrompt | null;
  seedancePackets: FilmmakingSeedancePacket[];
  issues: FilmmakingPromptIssue[];
}

export interface GenerateFilmmakingPromptsOptions {
  root?: string;
  projectSlug: string;
  durationSeconds?: number;
  storyboardGridPath?: string;
  /**
   * Render the storyboard grid prompt in a silhouette / no-face register so the
   * grid stays usable as a provider `reference_image` (real-person content
   * filters reject photoreal faces). See the multi-shot-framework Anti-patterns.
   */
  noFaces?: boolean;
  /**
   * Visual style/genre — the ai-filmmaking skill treats this as a swappable
   * parameter, not a hardcoded assumption. Known: live-action (default), pixar,
   * anime, noir, influencer/vlog, action/martial-arts, music-video. An unknown
   * value is passed through as a free-form style descriptor.
   */
  genre?: string;
  /**
   * Category id (see `category-registry.ts`). Resolves to a `CategoryDescriptor`
   * that supplies a default genre/style. Default (undefined) → the `cinematic`
   * character descriptor, whose genre is `'live-action'` — i.e. today's default,
   * so this is a no-op for the existing character/cinematic path. An explicit
   * `genre` still wins over the descriptor's genre. Unknown ids throw.
   */
  category?: string;
  /** Aspect ratio stated in every template (default 16:9; 9:16 for vertical/social). */
  aspectRatio?: string;
  /**
   * Storyboard panel count — 9, 12, 15 (default), or 20. Drives the grid layout
   * (3×3 / 3×4 / 3×5 / 4×5, transposed for vertical aspect ratios) and the
   * per-panel timecode breakdown. Mirrors the storyboard-prompt-builder skill.
   */
  panelCount?: number;
  /**
   * Cinematography language density (default `standard`). At `rich`, a quantified
   * cinematography suffix (lens mm, Kelvin, key angle, color-grade hue/sat, audio
   * dB hierarchy, move velocity in ft/s) is appended to the storyboard-grid Style
   * line and the text-driven Seedance STYLE/AUDIO lines. `terse`/`standard` emit
   * exactly today's output (no behavior change).
   */
  detail?: DetailLevel;
  /**
   * Two-phase gate (E5). `'storyboard'` returns the storyboard/camera-language
   * portion only (video `seedancePackets` gated to `[]`); `'video'` and the
   * default (omitted) return the full result. See {@link FilmmakingPhase}.
   */
  phase?: FilmmakingPhase;
  write?: boolean;
  /**
   * Character sheet layout variant (default `'8-shot'` — unchanged behavior).
   * Set to `'6-panel'` to opt into the compact 3-column × 2-row mid-gray sheet
   * built by {@link characterSheetSixPanelPrompt}.
   */
  sheetLayout?: '8-shot' | '6-panel';
  /**
   * Joey opt-in anti-plastic realism block (`captureRealismBlock`). When set, the
   * `rich`-detail storyboard-grid + text-driven CAMERA CAPTURE Style lines append
   * the keystone capture-realism clause. Omitted (default) → byte-identical to
   * today (the suffix is the legacy no-arg form). `wet`/`haze` only apply when
   * `realism` is enabled.
   */
  realism?: CaptureRealismOpts | false;
  /**
   * Lighting register id for the `rich`-detail cinematography suffix (default
   * `'neutral-studio'`). Omitted → legacy default. See `lightingSpec`.
   */
  lightingId?: string;
  /**
   * Color-grade register id for the `rich`-detail cinematography suffix (default
   * `'teal-orange'`). Omitted → legacy default. See `gradeSpec`.
   */
  gradeId?: string;
  /**
   * Backdrop plate kind. When set, appends a `backgroundPlate` clause to the
   * storyboard-grid Style line (opt-in, additive). Omitted (default) → no plate
   * clause, output unchanged. The character-sheet prompts keep their own
   * mid-gray default verbatim.
   */
  plateKind?: PlateKind;
}

// Quantified cinematography suffix appended only at detail === 'rich'. Built from
// the shared cinematography emitters so the numbers stay consistent with the
// multi-shot framework. Deterministic and pure.
const RICH_CAMERA_MOVE: CameraMove = {
  shot: 'master',
  lens: 35,
  angle: 'eye-level',
  movement: 'dolly',
};

export function richCinematographySuffix(opts: {
  lightingId?: string;
  gradeId?: string;
  realism?: CaptureRealismOpts | false;
} = {}): string {
  const lightingId = opts.lightingId ?? 'neutral-studio';
  const gradeId = opts.gradeId ?? 'teal-orange';
  const base =
    `Cinematography: ${cameraSpec(RICH_CAMERA_MOVE, 'rich')}; ` +
    `${lightingSpec(lightingId, 'rich')}; ` +
    `${gradeSpec(gradeId, 'rich')}.`;
  if (opts.realism) {
    return `${base} ${captureRealismBlock(opts.realism, 'rich')}`;
  }
  return base;
}

function richAudioSuffix(): string {
  return `Audio: ${audioMix('rich')}.`;
}

export const SUPPORTED_PANEL_COUNTS = [9, 12, 15, 20] as const;

// Grid layout per panel count (storyboard-prompt-builder skill). Horizontal
// orientation keeps cols ≥ rows; a vertical (taller-than-wide) aspect ratio
// transposes so the sheet reads top-to-bottom.
function gridLayout(panelCount: number, aspectRatio: string): { rows: number; cols: number } {
  const base: Record<number, { rows: number; cols: number }> = {
    9: { rows: 3, cols: 3 },
    12: { rows: 3, cols: 4 },
    15: { rows: 3, cols: 5 },
    20: { rows: 4, cols: 5 },
  };
  const layout = base[panelCount] ?? { rows: 3, cols: Math.ceil(panelCount / 3) };
  const [w, h] = aspectRatio.split(':').map((n) => Number(n));
  const vertical = Number.isFinite(w) && Number.isFinite(h) && h > w;
  return vertical ? { rows: layout.cols, cols: layout.rows } : layout;
}

export function resolvePanelCount(panelCount?: number): number {
  if (panelCount === undefined) return 15;
  if (!(SUPPORTED_PANEL_COUNTS as readonly number[]).includes(panelCount)) {
    throw new Error(`filmmaking-prompts: --panels must be one of ${SUPPORTED_PANEL_COUNTS.join(', ')} (got ${panelCount})`);
  }
  return panelCount;
}

export interface GenerateFilmmakingPromptsResult {
  artifact: FilmmakingPromptsArtifact;
  artifactPath?: string;
}

// The ai-filmmaking skill is genre-agnostic: the same skeleton renders
// photoreal, Pixar 3D, anime, noir, vlog, or stylized work — style is a
// swappable parameter. These blocks feed the character-sheet STYLE line, the
// storyboard grid Style descriptors, and the Seedance FORMAT tone, and pick the
// annotation third line (MOOD default / VOICE for vlog / STYLE for action).
export interface GenreStyle {
  genre: string;
  charSheetStyle: string;
  gridStyleDescriptors: string;
  annotationThirdLine: 'MOOD' | 'VOICE' | 'STYLE';
  formatTone: string;
}

const GENRE_STYLES: ReadonlyMap<string, GenreStyle> = new Map([
  ['live-action', {
    genre: 'live-action',
    charSheetStyle: 'photorealistic, life-like live action shot on a DSLR camera with 35mm film and muted color tones, do not make it look like a 3D render',
    gridStyleDescriptors: 'live-action, photorealistic, lifelike, 35mm film grain',
    annotationThirdLine: 'MOOD',
    formatTone: 'cinematic grounded realism',
  }],
  ['pixar', {
    genre: 'pixar',
    charSheetStyle: 'stylized 3D render in the visual language of modern Pixar features, soft global illumination, expressive proportions, no photoreal rendering',
    gridStyleDescriptors: 'stylized 3D Pixar-style render, soft global illumination, expressive proportions',
    annotationThirdLine: 'MOOD',
    formatTone: 'stylized 3D animation',
  }],
  ['anime', {
    genre: 'anime',
    charSheetStyle: '2D anime cel-shading, clean line work, painterly backgrounds, no 3D render',
    gridStyleDescriptors: '2D anime cel-shading, clean line work, painterly backgrounds',
    annotationThirdLine: 'MOOD',
    formatTone: '2D anime',
  }],
  ['noir', {
    genre: 'noir',
    charSheetStyle: 'high-contrast black and white film, harsh chiaroscuro lighting, 35mm grain',
    gridStyleDescriptors: 'high-contrast black and white, harsh chiaroscuro, 35mm grain',
    annotationThirdLine: 'MOOD',
    formatTone: 'high-contrast noir',
  }],
  ['influencer', {
    genre: 'influencer',
    charSheetStyle: 'natural daylight, iPhone selfie-camera aesthetic, soft skin tones, no cinematic grade',
    gridStyleDescriptors: 'natural daylight, iPhone selfie-camera aesthetic, soft skin tones',
    annotationThirdLine: 'VOICE',
    formatTone: 'handheld vlog realism',
  }],
  ['action', {
    genre: 'action',
    charSheetStyle: 'photorealistic, life-like live action shot on a DSLR camera with 35mm film and muted color tones, do not make it look like a 3D render',
    gridStyleDescriptors: 'live-action, photorealistic, kinetic, 35mm film grain',
    annotationThirdLine: 'STYLE',
    formatTone: 'kinetic action realism',
  }],
  ['music-video', {
    genre: 'music-video',
    charSheetStyle: 'photorealistic, life-like live action shot on a DSLR camera with 35mm film and muted color tones, do not make it look like a 3D render',
    gridStyleDescriptors: 'live-action, photorealistic, lifelike, 35mm film grain',
    annotationThirdLine: 'MOOD',
    formatTone: 'cinematic music-video energy',
  }],
]);

const GENRE_ALIASES: ReadonlyMap<string, string> = new Map([
  ['photorealistic', 'live-action'], ['photoreal', 'live-action'], ['cinematic', 'live-action'], ['realism', 'live-action'],
  ['3d', 'pixar'], ['animation', 'pixar'], ['cgi', 'pixar'],
  ['2d', 'anime'], ['cel', 'anime'],
  ['vlog', 'influencer'], ['social', 'influencer'], ['ugc', 'influencer'],
  ['martial-arts', 'action'], ['fight', 'action'], ['combat', 'action'],
  ['musicvideo', 'music-video'], ['music_video', 'music-video'], ['mv', 'music-video'],
]);

export function resolveGenreStyle(genre?: string): GenreStyle {
  if (!genre || !genre.trim()) return GENRE_STYLES.get('live-action')!;
  const key = genre.trim().toLowerCase();
  const canonical = GENRE_ALIASES.get(key) ?? key;
  const known = GENRE_STYLES.get(canonical);
  if (known) return known;
  // Unknown genre: pass the user's descriptor straight through (skill is
  // genre-agnostic), defaulting the annotation third line to MOOD.
  return {
    genre: genre.trim(),
    charSheetStyle: `${genre.trim()} style`,
    gridStyleDescriptors: genre.trim(),
    annotationThirdLine: 'MOOD',
    formatTone: genre.trim(),
  };
}

export async function generateFilmmakingPrompts(
  options: GenerateFilmmakingPromptsOptions,
): Promise<GenerateFilmmakingPromptsResult> {
  const root = options.root ?? process.cwd();
  const durationSeconds = options.durationSeconds ?? 15;
  const noFaces = options.noFaces ?? false;
  // Resolve the category descriptor (default → cinematic character descriptor).
  // The descriptor supplies a default genre; an explicit `--genre` still wins.
  // For the cinematic default this yields `'live-action'`, identical to today's
  // behavior — purely internal plumbing, no output change on the character path.
  // `subjectType` selects the branch: `'character'` (default) keeps today's
  // cinematic/character path verbatim; `'product'` takes the additive
  // product-subject branch below.
  const descriptor = resolveCategory(options.category);
  const effectiveGenre = options.genre ?? descriptor.genre;
  const genreStyle = resolveGenreStyle(effectiveGenre);
  const aspectRatio = options.aspectRatio?.trim() || '16:9';
  const panelCount = resolvePanelCount(options.panelCount);
  const detail = options.detail ?? 'standard';
  const workspace = await ensureProjectWorkspace(options.projectSlug, root);
  const brief = await readOptionalArtifact<BriefArtifact>(workspace, 'brief');
  const generatedAt = new Date().toISOString();

  if (descriptor.subjectType === 'product') {
    return generateProductPrompts({
      options,
      workspace,
      brief,
      descriptor,
      genreStyle,
      aspectRatio,
      durationSeconds,
      detail,
      generatedAt,
    });
  }

  const storyboard = await readOptionalArtifact<StoryboardArtifact>(workspace, 'storyboard');
  const assetManifest = await readOptionalArtifact<AssetManifestArtifact>(workspace, 'asset-manifest');
  const referenceSheets = await readReferenceSheetsArtifact(root, options.projectSlug);
  const characters = await listCharacterProfiles(workspace);
  const issues: FilmmakingPromptIssue[] = [];

  const sheetLayout = options.sheetLayout ?? '8-shot';
  const referenceMap = buildReferenceMap(referenceSheets, characters, assetManifest);
  const characterSheetPrompts = buildCharacterSheetPrompts(characters, referenceMap, issues, genreStyle, aspectRatio, sheetLayout);
  // Character lock: carry each character's identity description + its @imageN
  // slot forward into the Seedance Variant A SUBJECT lines (verbatim reuse is
  // the skill's most important rule).
  const characterContext = new Map<string, { slot?: string; description: string }>();
  for (const character of characters) {
    const slot = referenceMap.find((s) => s.role === 'character-sheet' && s.characterName === character.name && s.status === 'ready');
    characterContext.set(character.name, {
      ...(slot ? { slot: slot.slot } : {}),
      description: cleanSentence(character.description ?? `${character.name}, visually distinctive lead character`),
    });
  }
  const storyboardGridPrompt = storyboard
    ? buildStoryboardGridPrompt(storyboard, brief, characterSheetPrompts, noFaces, genreStyle, aspectRatio, panelCount, durationSeconds, detail, {
        ...(options.realism !== undefined ? { realism: options.realism } : {}),
        ...(options.lightingId !== undefined ? { lightingId: options.lightingId } : {}),
        ...(options.gradeId !== undefined ? { gradeId: options.gradeId } : {}),
        ...(options.plateKind !== undefined ? { plateKind: options.plateKind } : {}),
      })
    : null;
  if (!storyboard) {
    issues.push({
      code: 'storyboard-missing',
      severity: 'warning',
      message: 'No storyboard artifact exists; Seedance packets fall back to text-driven prompts.',
      path: 'artifacts/storyboard.json',
    });
  }

  if (storyboardGridPrompt) {
    const storyboardGridPath = options.storyboardGridPath?.trim();
    referenceMap.push({
      slot: nextSlot(referenceMap.length),
      role: 'storyboard-grid',
      label: '9-panel storyboard grid',
      ...(storyboardGridPath ? { path: storyboardGridPath } : {}),
      status: storyboardGridPath ? 'ready' : 'pending',
    });
    if (!storyboardGridPath) {
      issues.push({
        code: 'storyboard-grid-pending',
        severity: 'warning',
        message: 'Storyboard grid prompt was generated, but no rendered grid image is attached yet.',
      });
    }
  }

  // Two-phase gate (E5): in storyboard phase, omit the heavy video-generation
  // packets (and their packet-only issues) — return the storyboard/camera-
  // language portion only. Default/video phase builds the full packets.
  const seedancePackets = options.phase === 'storyboard'
    ? []
    : buildSeedancePackets({
        storyboard,
        brief,
        referenceMap,
        durationSeconds,
        noFaces,
        genreStyle,
        aspectRatio,
        characterContext,
        detail,
        issues,
      });

  const artifact: FilmmakingPromptsArtifact = {
    schemaVersion: 1,
    projectSlug: options.projectSlug,
    generatedAt,
    sourceSkill: 'ai-filmmaking',
    durationDefaultSeconds: durationSeconds,
    referenceMap,
    characterSheetPrompts,
    storyboardGridPrompt,
    seedancePackets,
    issues,
  };

  if (!options.write) return { artifact };
  return {
    artifact,
    artifactPath: await writeArtifact(workspace, 'filmmaking-prompts', artifact),
  };
}

// ---------------------------------------------------------------------------
// Product-subject branch (descriptor.subjectType === 'product').
//
// Additive path: NO character sheets, NO storyboard-grid character lock. Each
// product becomes a text-driven Seedance packet whose timeline follows the
// descriptor's beat template (ad-hook-feature-cta / turntable / lookbook), with
// orbit grammar woven in for orbit/turntable camera vocabularies and the
// product reference assets carried as @imageN reference slots.
// ---------------------------------------------------------------------------
async function generateProductPrompts(input: {
  options: GenerateFilmmakingPromptsOptions;
  workspace: VideoProjectWorkspace;
  brief: BriefArtifact | undefined;
  descriptor: CategoryDescriptor;
  genreStyle: GenreStyle;
  aspectRatio: string;
  durationSeconds: number;
  detail: DetailLevel;
  generatedAt: string;
}): Promise<GenerateFilmmakingPromptsResult> {
  const { options, workspace, brief, descriptor, genreStyle, aspectRatio, durationSeconds, detail, generatedAt } = input;
  const issues: FilmmakingPromptIssue[] = [];
  const { products } = await readProductReferences(workspace);

  const productList = products.length > 0
    ? products
    : [{ name: brief?.title ?? 'the product', referenceAssets: [] as string[] }];
  if (products.length === 0) {
    issues.push({
      code: 'reference-slot-pending',
      severity: 'warning',
      message: 'No product-references.json found; product packets fall back to a description-only hero from the brief.',
      path: 'artifacts/product-references.json',
    });
  }

  const referenceMap: FilmmakingReferenceSlot[] = [];
  for (const product of productList) {
    for (const asset of product.referenceAssets) {
      referenceMap.push({
        slot: nextSlot(referenceMap.length),
        role: 'reference-image',
        label: `${product.name} reference`,
        path: asset,
        status: 'ready',
      });
    }
  }

  const orbitKind = descriptor.beatTemplate === 'turntable' ? 'product-rotation' : 'camera-orbit';
  const useOrbit = descriptor.cameraVocab === 'orbit' || descriptor.beatTemplate === 'turntable';

  // Two-phase gate (E5): storyboard phase omits the video-generation packets.
  const productPackets: FilmmakingSeedancePacket[] = productList.map((product, index) => {
    const productSlots = referenceMap.filter((slot) => slot.label === `${product.name} reference`);
    const productBeats = beats(descriptor.beatTemplate, durationSeconds, descriptor.hookSeconds);
    return {
      sceneIndex: index,
      variant: 'text-driven',
      durationSeconds,
      references: productSlots,
      promptText: productPromptText({
        product,
        productSlots,
        brief,
        descriptor,
        genreStyle,
        aspectRatio,
        durationSeconds,
        detail,
        productBeats,
        useOrbit,
        orbitKind,
      }),
      warnings: productSlots.filter((slot) => slot.status === 'pending').map((slot) => `${slot.slot} ${slot.label} is pending.`),
    };
  });
  const seedancePackets = options.phase === 'storyboard' ? [] : productPackets;

  const artifact: FilmmakingPromptsArtifact = {
    schemaVersion: 1,
    projectSlug: options.projectSlug,
    generatedAt,
    sourceSkill: 'ai-filmmaking',
    durationDefaultSeconds: durationSeconds,
    referenceMap,
    characterSheetPrompts: [],
    storyboardGridPrompt: null,
    seedancePackets,
    issues,
  };

  if (!options.write) return { artifact };
  return {
    artifact,
    artifactPath: await writeArtifact(workspace, 'filmmaking-prompts', artifact),
  };
}

function productPromptText(input: {
  product: { name: string; referenceAssets: string[] };
  productSlots: FilmmakingReferenceSlot[];
  brief: BriefArtifact | undefined;
  descriptor: CategoryDescriptor;
  genreStyle: GenreStyle;
  aspectRatio: string;
  durationSeconds: number;
  detail: DetailLevel;
  productBeats: Beat[];
  useOrbit: boolean;
  orbitKind: 'product-rotation' | 'camera-orbit';
}): string {
  const { product, productSlots, brief, descriptor, genreStyle, aspectRatio, durationSeconds, detail, productBeats, useOrbit, orbitKind } = input;
  const productName = cleanSentence(product.name) || 'the product';
  const subjectDescription = cleanSentence(brief?.intent ?? '') || `the hero product, ${productName}`;
  const refLine = productSlots.length > 0
    ? `REFERENCE: ${productSlots.map((slot) => `${slot.slot} (${slot.label})`).join(', ')} — match the product's exact form, color, finish, and proportions.`
    : 'REFERENCE: no reference image attached — render the product faithfully from the description.';
  const heroNote = descriptor.beatTemplate === 'turntable'
    ? 'Open and close on the hero three-quarter angle; the rotation must return cleanly to that hero framing.'
    : '';
  const orbitLine = useOrbit ? `CAMERA: ${orbitGrammar(orbitKind)}` : '';
  const lines = [
    `FORMAT: ${durationSeconds} seconds / ${genreStyle.formatTone} / ${aspectRatio} / ${descriptor.label}`,
    '',
    `PRODUCT: ${productName} — ${subjectDescription}.`,
    refLine,
    orbitLine,
    heroNote,
    `STYLE: ${genreStyle.gridStyleDescriptors}. Aspect ratio ${aspectRatio} held across every shot.${detail === 'rich' ? ` ${richCinematographySuffix()}` : ''}`,
    `AUDIO: diegetic product sound only, natural ambience, no voice-over unless the brief asks.${detail === 'rich' ? ` ${richAudioSuffix()}` : ''}`,
    '',
    `TIMELINE (must cover full 0:00-${formatSeconds(durationSeconds)}):`,
    ...productBeats.map((beat) => (
      `${formatSeconds(Math.round(beat.start))}-${formatSeconds(Math.round(beat.end))} ${beat.label.toUpperCase()}: ${beat.direction}.`
    )),
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Map a reference slot's role onto its canonical build step (the banana-pro-
 * director discipline). `background-plate` is the scene-context-free `base-ref`;
 * the character sheet is the `sheet`; every in-context frame is a `scene-plate`.
 */
function buildStepForRole(role: FilmmakingReferenceSlot['role']): ReferenceBuildStep {
  switch (role) {
    case 'background-plate':
      return 'base-ref';
    case 'character-sheet':
      return 'sheet';
    case 'storyboard-grid':
    case 'start-frame':
    case 'end-frame':
    case 'reference-image':
      return 'scene-plate';
  }
}

function buildReferenceMap(
  referenceSheets: ReferenceSheetsArtifact,
  characters: CharacterProfile[],
  assetManifest: AssetManifestArtifact | undefined,
): FilmmakingReferenceSlot[] {
  // Collect every slot first (the `slot` field is assigned last, once the final
  // build-order is known, so `@imageN == array order` per WS0).
  const collected: Omit<FilmmakingReferenceSlot, 'slot'>[] = [];
  for (const character of characters) {
    const identitySheet = findIdentitySheet(referenceSheets, character.name);
    const path = firstCharacterReference(character, identitySheet);
    collected.push({
      role: 'character-sheet',
      label: `${character.name} character sheet`,
      characterName: character.name,
      ...(path ? { path } : {}),
      status: path ? 'ready' : 'pending',
    });
  }

  for (const asset of assetManifest?.assets ?? []) {
    if (asset.kind !== 'image') continue;
    if (asset.role === 'background-plate') {
      // A scene-context-free background/base plate (no sceneIndex required).
      if (collected.some((slot) => slot.role === 'background-plate' && slot.path === asset.path)) continue;
      collected.push({
        role: 'background-plate',
        label: 'Background plate',
        path: asset.path,
        status: 'ready',
      });
      continue;
    }
    if (!Number.isInteger(asset.sceneIndex)) continue;
    if (collected.some((slot) => slot.path === asset.path && slot.sceneIndex === asset.sceneIndex)) continue;
    collected.push({
      role: 'start-frame',
      label: `Scene ${asset.sceneIndex} start frame`,
      path: asset.path,
      sceneIndex: asset.sceneIndex,
      status: 'ready',
    });
  }

  // Consult the canonical reference build order (base-ref -> sheet -> scene-plate)
  // and group the collected slots by build step. The sort is STABLE, so within a
  // step the original collection order is preserved — and the canonical character
  // sheet (a `sheet` step) is never displaced/replaced by a scene plate. A default
  // single-character project (sheet only) keeps its original order unchanged.
  const order = referenceBuildOrder('character');
  const rank = new Map<ReferenceBuildStep, number>(order.map((step, index) => [step, index] as const));
  const ordered = collected
    .map((slot, index) => ({ slot, index }))
    .sort((left, right) => {
      const leftRank = rank.get(buildStepForRole(left.slot.role)) ?? order.length;
      const rightRank = rank.get(buildStepForRole(right.slot.role)) ?? order.length;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.index - right.index;
    })
    .map((entry) => entry.slot);

  return ordered.map((slot, index) => ({ slot: nextSlot(index), ...slot }));
}

function buildCharacterSheetPrompts(
  characters: CharacterProfile[],
  referenceMap: FilmmakingReferenceSlot[],
  issues: FilmmakingPromptIssue[],
  genreStyle: GenreStyle,
  aspectRatio: string,
  sheetLayout: '8-shot' | '6-panel' = '8-shot',
): FilmmakingCharacterSheetPrompt[] {
  return characters.map((character) => {
    const slots = referenceMap.filter((slot) => slot.role === 'character-sheet' && slot.characterName === character.name);
    const readySlots = slots.filter((slot) => slot.status === 'ready').map((slot) => slot.slot);
    const mode = readySlots.length > 0 ? 'reference-image' : 'description-only';
    const description = cleanSentence(character.description ?? `${character.name}, visually distinctive lead character`);
    const wordCount = description.split(/\s+/).filter(Boolean).length;
    if (!character.description) {
      issues.push({
        code: 'character-description-missing',
        severity: 'warning',
        message: `${character.name} has no stored identity description; generated prompt uses a fallback.`,
      });
    } else if (wordCount > 100) {
      // The skill calls >100 words an outright failure: bloat dilutes the
      // identity signal and bakes scene contamination into the reference.
      issues.push({
        code: 'character-description-long',
        severity: 'error',
        message: `${character.name} identity description is ${wordCount} words; ai-filmmaking treats >100 as a failure (target 30-60). Trim scene effects/atmosphere down to identity-locking traits.`,
      });
    } else if (wordCount > 60) {
      issues.push({
        code: 'character-description-long',
        severity: 'warning',
        message: `${character.name} identity description is ${wordCount} words; ai-filmmaking target is 30-60 words.`,
      });
    }
    return {
      characterName: character.name,
      mode,
      referenceSlots: readySlots,
      promptText: sheetLayout === '6-panel'
        ? characterSheetSixPanelPrompt(description, genreStyle.charSheetStyle, aspectRatio)
        : mode === 'reference-image'
          ? characterSheetReferencePrompt(readySlots, genreStyle.charSheetStyle, aspectRatio)
          : characterSheetDescriptionPrompt(description, genreStyle.charSheetStyle, aspectRatio),
    };
  });
}

function buildStoryboardGridPrompt(
  storyboard: StoryboardArtifact,
  brief: BriefArtifact | undefined,
  characterPrompts: FilmmakingCharacterSheetPrompt[],
  noFaces = false,
  genreStyle: GenreStyle = resolveGenreStyle(),
  aspectRatio = '16:9',
  panelCount = 15,
  durationSeconds = 15,
  detail: DetailLevel = 'standard',
  // Joey opt-in cinematography overrides (default {} → byte-identical output).
  cinematics: {
    realism?: CaptureRealismOpts | false;
    lightingId?: string;
    gradeId?: string;
    plateKind?: PlateKind;
  } = {},
): FilmmakingStoryboardGridPrompt {
  const { rows, cols } = gridLayout(panelCount, aspectRatio);
  const panels = buildPanels(storyboard, panelCount, durationSeconds, cols);
  const characters = characterPrompts
    .map((prompt) => `${prompt.characterName.toUpperCase()}: ${characterLine(prompt)}`)
    .join('\n');
  const sceneType = brief?.productionMode === 'director' ? 'cinematic director scene' : 'cinematic sequence';
  const location = brief?.title ?? storyboard.projectSlug;
  const third = genreStyle.annotationThirdLine; // MOOD | VOICE | STYLE
  const noFaceClause = noFaces
    ? ' Render ALL figures as backlit silhouettes, shot from behind, or at distance — faces obscured, in shadow, or turned away, with NO clear frontal facial features (this keeps the sheet usable as a provider reference image despite real-person content filters).'
    : '';
  // At `rich`, append a quantified cinematography suffix to the Style line.
  // `terse`/`standard` keep the line byte-identical to today. When any Joey
  // cinematography override is set, pass them through; otherwise the no-arg call
  // reproduces today's legacy suffix exactly.
  const hasCinematicsOverride =
    cinematics.realism !== undefined
    || cinematics.lightingId !== undefined
    || cinematics.gradeId !== undefined;
  const richStyleSuffix = detail === 'rich'
    ? ` ${hasCinematicsOverride ? richCinematographySuffix({
        ...(cinematics.realism !== undefined ? { realism: cinematics.realism } : {}),
        ...(cinematics.lightingId !== undefined ? { lightingId: cinematics.lightingId } : {}),
        ...(cinematics.gradeId !== undefined ? { gradeId: cinematics.gradeId } : {}),
      }) : richCinematographySuffix()}`
    : '';
  // Opt-in backdrop plate clause. Omitted → no clause, Style line unchanged.
  const plateClause = cinematics.plateKind !== undefined
    ? ` Backdrop: ${backgroundPlate(cinematics.plateKind, detail)}.`
    : '';
  const promptText = [
    // A) Title & format header
    `Create a professional ${durationSeconds}-second ${genreStyle.formatTone} storyboard sheet for "${location}" — a complete production presentation page of ${panelCount} sequential cinematic panels arranged in a clean ${rows}×${cols} grid layout, depicting ONE CONTINUOUS ${sceneType}.`,
    '',
    // B) Style declaration
    `Style: Cinematic, production-grade, ${genreStyle.gridStyleDescriptors}.${noFaceClause} Aspect ratio = ${aspectRatio} page layout.${richStyleSuffix}${plateClause}`,
    '',
    // C) Character descriptions + lock
    'CHARACTER LOCK - all recurring characters must appear IDENTICAL across every panel (same face, same build, same clothing, same props). Use the descriptions below as the source of truth. If reference images are attached, treat them as additional identity anchors and match them precisely.',
    characters || 'NO NAMED CHARACTER: preserve the same subject, setting, palette, and camera language across all panels.',
    '',
    // D) Visual tone
    `Visual tone: consistent colour grade, lighting logic, and lens language across all ${panelCount} panels — establish it once and hold it. This is one continuous moment in ${location}: same geography, same lighting, same wardrobe, same props.`,
    '',
    // E) Storyboard layout details
    `Storyboard sheet layout: a clean ${rows}×${cols} grid on a neutral production board, thin clean separators between panels, each panel numbered with its timecode label, a short shot description beneath. UNDER EACH panel a thin off-white annotation strip with three short lines in a clean, high-contrast sans-serif font legible at rendered size: CAM, MOVE, and ${third}. Notes must read as short uppercase slug lines, not sentences. No readable UI text, no logos unless already part of the brief. Camera moves naturally around the action as if shot in a single continuous take broken into ${panelCount} sequential beats.`,
    '',
    // F) Scene breakdown (read left-to-right, top-to-bottom)
    'Narrative - read left-to-right, top-to-bottom:',
    ...panels.map((panel) => (
      `Panel ${panel.panel} ${panel.timecode} (${panel.position}): ${panel.beat}. CAM: ${panel.cam}. MOVE: ${panel.move}. ${third}: ${panel.mood}.`
    )),
    '',
    // G/H) Art-direction + rendering footer
    `Art direction: vary the framing every panel (wide -> medium -> close-up -> over-the-shoulder), build intensity through the middle, peak near the end, then resolve. Distribute character detail across panels — faces in close-ups, full wardrobe in wides. Render quality: masterpiece, production-ready, ${aspectRatio} professional storyboard sheet.`,
  ].join('\n');
  return {
    variant: 'storyboard-grid',
    panelCount,
    rows,
    cols,
    promptText,
    panels,
  };
}

function buildSeedancePackets(input: {
  storyboard: StoryboardArtifact | undefined;
  brief: BriefArtifact | undefined;
  referenceMap: FilmmakingReferenceSlot[];
  durationSeconds: number;
  noFaces?: boolean;
  genreStyle: GenreStyle;
  aspectRatio: string;
  characterContext: Map<string, { slot?: string; description: string }>;
  detail: DetailLevel;
  issues: FilmmakingPromptIssue[];
}): FilmmakingSeedancePacket[] {
  const scenes = input.storyboard?.scenes ?? [];
  const characterSlots = input.referenceMap.filter((slot) => slot.role === 'character-sheet');
  const gridSlot = input.referenceMap.find((slot) => slot.role === 'storyboard-grid');
  if (gridSlot?.status === 'pending') {
    input.issues.push({
      code: 'reference-slot-pending',
      severity: 'warning',
      message: `${gridSlot.slot} is reserved for the storyboard grid, but the rendered grid image is not attached yet.`,
    });
  }
  if (input.genreStyle?.genre !== 'music-video') {
    input.issues.push({
      code: 'seedance-music-default',
      severity: 'warning',
      message: 'Seedance packets default to NO MUSIC unless a scene prompt explicitly asks for music.',
    });
  }
  return scenes.map((scene) => {
    const startFrame = input.referenceMap.find((slot) => slot.role === 'start-frame' && slot.sceneIndex === scene.sceneIndex);
    const references = [
      ...characterSlots.filter((slot) => !scene.characters?.length || scene.characters.includes(slot.characterName ?? '')),
      ...(gridSlot ? [gridSlot] : []),
      ...(startFrame ? [startFrame] : []),
    ];
    const variant = gridSlot && characterSlots.length > 0
      ? 'character-sheets-plus-storyboard-grid'
      : gridSlot
        ? 'storyboard-grid-reference'
        : 'text-driven';
    const promptText = seedancePromptText({
      scene,
      brief: input.brief,
      references,
      variant,
      durationSeconds: scene.durationSeconds ?? input.durationSeconds,
      noFaces: input.noFaces ?? false,
      genreStyle: input.genreStyle,
      aspectRatio: input.aspectRatio,
      characterContext: input.characterContext,
      detail: input.detail,
    });
    // QA gate (WS6): only the text-driven packet follows the 10-block contract;
    // grid variants intentionally use the grid-reference body shape.
    if (variant === 'text-driven') {
      const blockIssue = checkSeedanceBlockOrder(promptText);
      if (blockIssue) input.issues.push(blockIssue);
    }
    return {
      sceneIndex: scene.sceneIndex,
      variant,
      durationSeconds: scene.durationSeconds ?? input.durationSeconds,
      references,
      promptText,
      warnings: references.filter((reference) => reference.status === 'pending')
        .map((reference) => `${reference.slot} ${reference.label} is pending.`),
    };
  });
}

// Canonical 10-block order for the text-driven Seedance master-prompt (WS6).
// Source of truth shared by seedancePromptText (which emits them) and
// checkSeedanceBlockOrder (which validates them) so they cannot drift.
const SEEDANCE_BLOCK_ORDER = [
  'SCENE & MOOD',
  'FRAME MAP',
  'SUBJECT LOCK',
  'CROSS-FRAME',
  'MOVEMENT',
  'LAST FRAME',
  'WORLD PLATE',
  'SOUND BED',
  'CAPTURE REALISM',
  'CAMERA CAPTURE',
] as const;

/**
 * QA validator (WS6): confirm a text-driven Seedance packet carries all ten
 * Joey master-prompt blocks in the canonical order. Returns a warning-level
 * {@link FilmmakingPromptIssue} when a block is missing or out of sequence, or
 * `null` when the packet is well-formed. Pure/deterministic — operates on the
 * rendered prompt text only.
 */
export function checkSeedanceBlockOrder(promptText: string): FilmmakingPromptIssue | null {
  let last = -1;
  for (const block of SEEDANCE_BLOCK_ORDER) {
    const idx = promptText.indexOf(block);
    if (idx === -1) {
      return {
        code: 'seedance-block-order',
        severity: 'warning',
        message: `text-driven Seedance packet is missing the "${block}" block (expected the 10-block order: ${SEEDANCE_BLOCK_ORDER.join(' → ')}).`,
      };
    }
    if (idx < last) {
      return {
        code: 'seedance-block-order',
        severity: 'warning',
        message: `text-driven Seedance packet has the "${block}" block out of order (expected the 10-block order: ${SEEDANCE_BLOCK_ORDER.join(' → ')}).`,
      };
    }
    last = idx;
  }
  return null;
}

// Positive-direction guard so the model performs the grid panels over time
// instead of reproducing the 3x3 collage as a moving split-screen frame.
// See multi-shot-framework Anti-patterns ("Grid leakage").
const GRID_SINGLE_FRAME_GUARD =
  'Output a single full-frame cinematic shot that fills the entire frame edge to edge — no 3x3 grid, no split-screen, no panel borders, no collage, no multi-panel montage. The storyboard grid is reference ONLY; perform its panels as consecutive moments over time, never as one image.';

/** @internal — exported for testing the text-driven AUDIO / MOOD branch only. */
export function seedancePromptText(input: {
  scene: StoryboardArtifact['scenes'][number];
  brief: BriefArtifact | undefined;
  references: FilmmakingReferenceSlot[];
  variant: FilmmakingSeedancePacket['variant'];
  durationSeconds: number;
  noFaces?: boolean;
  genreStyle?: GenreStyle;
  aspectRatio?: string;
  characterContext?: Map<string, { slot?: string; description: string }>;
  detail?: DetailLevel;
}): string {
  const genreStyle = input.genreStyle ?? resolveGenreStyle();
  const aspectRatio = input.aspectRatio ?? '16:9';
  const detail = input.detail ?? 'standard';
  const characterRefs = input.references.filter((reference) => reference.role === 'character-sheet');
  const gridRef = input.references.find((reference) => reference.role === 'storyboard-grid');
  const startFrame = input.references.find((reference) => reference.role === 'start-frame');
  const duration = `${input.durationSeconds} seconds`;
  const action = cleanSentence(input.scene.scenePrompt?.animationPrompt ?? input.scene.description);
  const noFaceLine = input.noFaces
    ? 'Keep all figures as backlit silhouettes, backs, or distance with faces obscured (content-filter safe).'
    : '';
  // Invariant: ANY packet that references a storyboard grid must carry the
  // single-frame guard, or the grid leaks as an animated split-screen. Enforce
  // it once at the exit (keyed on gridRef) so a new grid-bearing variant can't
  // silently omit it. `withGridGuard` is a no-op when the body already includes
  // the guard text (the explicit branches below keep it inline for wording).
  const withGridGuard = (body: string): string => (
    gridRef && !body.includes(GRID_SINGLE_FRAME_GUARD)
      ? `${body}\n${GRID_SINGLE_FRAME_GUARD}`
      : body
  );
  if (input.variant === 'character-sheets-plus-storyboard-grid' && gridRef) {
    return withGridGuard([
      ...characterRefs.map((reference, index) => `Character ${index + 1}: ${reference.slot} (${reference.label})`),
      '',
      `Use the provided character sheets and cinematic storyboard grid ${gridRef.slot} as visual and motion reference. Create a ${duration} ${genreStyle.formatTone} sequence at ${aspectRatio}. ${GRID_SINGLE_FRAME_GUARD} Follow the panel order, camera logic, motion, and framing consistently and temporally. NO TEXT ON SCREEN, NO MUSIC.`,
      noFaceLine,
      startFrame ? `Use ${startFrame.slot} as the scene start-frame continuity anchor.` : '',
      '',
      `Storyline: ${action}`,
    ].filter(Boolean).join('\n'));
  }
  if (input.variant === 'storyboard-grid-reference' && gridRef) {
    return withGridGuard([
      `Use the provided cinematic storyboard grid ${gridRef.slot} as visual and motion reference. Create a ${duration} ${genreStyle.formatTone} sequence at ${aspectRatio}. ${GRID_SINGLE_FRAME_GUARD} Follow the panel order, camera logic, motion and camera framing consistently. Handheld camera moments may be used to boost realism. NO TEXT ON SCREEN, NO MUSIC.`,
      noFaceLine,
      startFrame ? `Use ${startFrame.slot} as the scene start-frame continuity anchor.` : '',
      '',
      `Storyline: ${action}`,
    ].filter(Boolean).join('\n'));
  }
  // Variant A (text-driven) — the Joey 10-block Seedance master-prompt (WS6, now
  // the default packet shape). The blocks are assembled in a fixed contract order
  // (SCENE & MOOD → FRAME MAP → SUBJECT LOCK → CROSS-FRAME → MOVEMENT → LAST FRAME
  // → WORLD PLATE → SOUND BED → CAPTURE REALISM → CAMERA CAPTURE) using the
  // shared seedance-blocks.ts / cinematography.ts emitters. `terse`/`standard`
  // detail emit no quantified cinematography tokens; `rich` appends them.
  const soundBed = genreStyle.genre === 'music-video'
    ? `SOUND BED: Music-driven — ${musicSyncLine(undefined, detail)}.`
    : `SOUND BED: No music. Natural ambience and subject-driven sound only.${detail === 'rich' ? ` ${richAudioSuffix()}` : ''}`;
  return [
    `SCENE & MOOD: ${duration} ${genreStyle.formatTone} at ${aspectRatio}. ${cleanSentence(input.brief?.intent ?? input.scene.description)}.`,
    '',
    frameMapBlock(threeBeatFrameMap(input.durationSeconds, action, aspectRatio)),
    '',
    subjectLockBlock(subjectLockEntriesFromContext(input)),
    '',
    crossFrameBlock(),
    '',
    `MOVEMENT: ${cameraSpec(RICH_CAMERA_MOVE, detail)}.`,
    '',
    lastFrameBlock('resolved final beat, clean composition'),
    '',
    `WORLD PLATE: ${input.brief?.title ?? input.scene.description}.`,
    '',
    soundBed,
    '',
    `CAPTURE REALISM: ${captureRealismBlock({}, detail)}`,
    '',
    `CAMERA CAPTURE: ${genreStyle.gridStyleDescriptors}, ${aspectRatio} held across every shot.${detail === 'rich' ? ` ${richCinematographySuffix({ realism: {} })}` : ''}`,
    noFaceLine,
  ].filter(Boolean).join('\n');
}

// FRAME MAP rows for the text-driven packet — the original three-beat timeline
// (wide establish → medium develop → resolved close), now emitted as ordered
// FrameMapEntry rows keyed on the same 0:00 / d÷3 / 2d÷3 / d split.
function threeBeatFrameMap(durationSeconds: number, action: string, aspectRatio: string): FrameMapEntry[] {
  const third = Math.floor(durationSeconds / 3);
  const twoThirds = Math.floor((durationSeconds * 2) / 3);
  return [
    { t: `0:00-${formatSeconds(third)}`, beat: `Wide establishing shot, ${aspectRatio} — ${action}` },
    { t: `${formatSeconds(third)}-${formatSeconds(twoThirds)}`, beat: `Medium shot, ${aspectRatio} — preserve subject identity and geography while the action develops` },
    { t: `${formatSeconds(twoThirds)}-${formatSeconds(durationSeconds)}`, beat: `Close-up or resolved final frame, ${aspectRatio} — complete the scene beat cleanly` },
  ];
}

// SUBJECT LOCK entries from the carried character context. Per WS0/WS5, @imageN
// slots are emitted as hard binding labels ONLY when POSITIONAL_BINDING is true;
// otherwise each character's locked identity description is carried as a
// descriptor-only guidance label (visual descriptor, never a proper name as the
// binding key). Falls back to a single primary-subject entry when no characters
// are present on the scene.
function subjectLockEntriesFromContext(input: {
  scene: StoryboardArtifact['scenes'][number];
  characterContext?: Map<string, { slot?: string; description: string }>;
}): SubjectLockEntry[] {
  const names = input.scene.characters ?? [];
  if (names.length === 0) return [];
  return names.map((name, index) => {
    const ctx = input.characterContext?.get(name);
    const label = ctx?.description ?? name;
    const slot = POSITIONAL_BINDING && ctx?.slot ? ctx.slot : `subject ${index + 1}`;
    return { label, slot };
  });
}

export function characterSheetReferencePrompt(referenceSlots: string[], style: string, aspectRatio: string): string {
  return `Create a professional character reference sheet for the attached character using ${referenceSlots.join(', ')} as strong reference, 1:1 similarity, ${style}. Divide the sheet into four vertical columns for a total of eight shots. The top row shows full-body views from head to toe: front, side, three-quarter, and back. No cropping at ankles, knees, or head. The bottom row contains four matching face close-ups, including front and profile views. Use clean neutral studio lighting. Background: even neutral mid-gray seamless, no seam line, no gradient, subject rendered at true natural tone against the neutral gray. Aspect ratio = ${aspectRatio}.`;
}

export function characterSheetDescriptionPrompt(description: string, style: string, aspectRatio: string): string {
  return `Create a professional character reference sheet for ${description}. Divide the sheet into four vertical columns for a total of eight shots. The top row shows full-body views from head to toe: front, side, three-quarter, and back. No cropping at ankles, knees, or head. The bottom row contains four matching face close-ups, including front and profile views. Style: ${style}. Use clean neutral studio lighting, no scene-specific lighting. Background: even neutral mid-gray seamless, no seam line, no gradient, subject rendered at true natural tone against the neutral gray. Aspect ratio = ${aspectRatio}.`;
}

export function characterSheetSixPanelPrompt(description: string, style: string, aspectRatio: string): string {
  return [
    `A 6-panel character reference sheet arranged as a 3-column by 2-row grid in a single ${aspectRatio} frame, thin clean white gutters between panels.`,
    `Each panel shows the same single character — ${description}.`,
    'Panel 1 (top-left): full body front. Panel 2 (top-center): side profile close headshot, left side. Panel 3 (top-right): full body back.',
    'Panel 4 (bottom-left): side profile close headshot, right side. Panel 5 (bottom-center): front face close headshot. Panel 6 (bottom-right): detail shot (hands / accessory / held prop).',
    'Even neutral mid-gray seamless backdrop applied uniformly across all six panels, no seam line, no gradient.',
    `Style: ${style}. Identical character identity locked across all six panels — same face, skin, hair, wardrobe, accessories, proportions in every cell.`,
  ].join(' ');
}

function buildPanels(
  storyboard: StoryboardArtifact,
  panelCount: number,
  durationSeconds: number,
  cols: number,
): FilmmakingStoryboardPanel[] {
  const scenes = storyboard.scenes.length > 0 ? storyboard.scenes : [{
    sceneIndex: 0,
    description: 'Opening visual beat',
  }];
  return Array.from({ length: panelCount }, (_, index) => {
    // Map each panel onto a scene proportionally so N panels spread across the
    // available scenes instead of cycling 1:1.
    const scene = scenes[Math.min(Math.floor((index / panelCount) * scenes.length), scenes.length - 1)];
    const row = Math.floor(index / cols) + 1;
    const col = (index % cols) + 1;
    return {
      panel: index + 1,
      position: `row ${row}, col ${col}`,
      timecode: panelTimecode(index, panelCount, durationSeconds),
      beat: shortBeat(scene.description, index, scenes.length),
      cam: cameraLine(index),
      move: moveLine(scene.description),
      mood: actBeat(index, panelCount),
    };
  });
}

// Split totalSeconds evenly across panelCount panels → [MM:SS - MM:SS] per panel.
function panelTimecode(index: number, panelCount: number, totalSeconds: number): string {
  const start = Math.round((index / panelCount) * totalSeconds);
  const end = Math.round(((index + 1) / panelCount) * totalSeconds);
  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `[${fmt(start)} - ${fmt(end)}]`;
}

function shortBeat(value: string, index: number, sceneCount: number): string {
  const cleaned = cleanSentence(value).split(/\s+/).slice(0, 12).join(' ');
  if (index >= sceneCount) return `Resolved echo of ${cleaned.toLowerCase()}`;
  return cleaned;
}

const CAMERA_VOCAB = [
  'WIDE. LOW TRACK',
  'MEDIUM. WHIP PAN',
  'CLOSE. STATIC',
  'OVER SHOULDER. PUSH',
  'WIDE. SLOW ORBIT',
  'MEDIUM CLOSE. HANDHELD',
  'LOW ANGLE. PUSH IN',
  'PROFILE. TRACK',
  'CLOSE. SOFT HOLD',
  'HIGH ANGLE. CRANE DOWN',
  'MACRO. RACK FOCUS',
  'DUTCH. SNAP ZOOM',
];

// Never repeat a framing in consecutive panels (skill: vary shot types).
function cameraLine(index: number): string {
  return CAMERA_VOCAB[index % CAMERA_VOCAB.length];
}

function moveLine(description: string): string {
  return cleanSentence(description).split(/\s+/).slice(0, 6).join(' ').toUpperCase();
}

// Three-act emotional progression across the panels (storyboard-prompt-builder):
// setup -> inciting -> rising tension -> climax -> denouement.
function actBeat(index: number, panelCount: number): string {
  const p = (index + 1) / panelCount;
  if (p <= 0.2) return 'SETUP. ESTABLISH.';
  if (p <= 0.4) return 'INCITING. SHIFT.';
  if (p <= 0.7) return 'RISING. BUILD TENSION.';
  if (p <= 0.87) return 'CLIMAX. PEAK INTENSITY.';
  return 'DENOUEMENT. RESOLVE.';
}

function characterLine(prompt: FilmmakingCharacterSheetPrompt): string {
  if (prompt.mode === 'reference-image') return `Locked by ${prompt.referenceSlots.join(', ')}. Keep face, build, wardrobe, and props identical.`;
  return prompt.promptText
    .replace(/^Create a professional character reference sheet for\s+/i, '')
    .split('. Divide the sheet')[0] ?? prompt.characterName;
}

function findIdentitySheet(referenceSheets: ReferenceSheetsArtifact, characterName: string): ReferenceSheet | undefined {
  return referenceSheets.sheets.find((sheet) => (
    sheet.type === 'identity'
    && (sheet.characterName === characterName || sheet.name === characterName)
  ));
}

function firstCharacterReference(character: CharacterProfile, sheet: ReferenceSheet | undefined): string | null {
  if (character.referenceAssets[0]) return character.referenceAssets[0];
  const pathRef = sheet?.references.find((reference) => 'path' in reference);
  return pathRef && 'path' in pathRef ? pathRef.path : null;
}

async function readOptionalArtifact<T>(
  workspace: VideoProjectWorkspace,
  name: Parameters<typeof artifactPathFor>[1],
): Promise<T | undefined> {
  const path = artifactPathFor(workspace, name);
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, 'utf-8')) as T;
}

function nextSlot(index: number): string {
  return `@image${index + 1}`;
}

function cleanSentence(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\[[^\]]+\]/g, '')
    .trim()
    .replace(/[.。]+$/g, '');
}

function formatSeconds(seconds: number): string {
  return `0:${String(seconds).padStart(2, '0')}`;
}
