import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { artifactPathFor, writeArtifact } from './artifact-store.js';
import type { AssetManifestArtifact, BriefArtifact, StoryboardArtifact } from './artifacts.js';
import { listCharacterProfiles, type CharacterProfile } from './characters.js';
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import type { ReferenceSheet, ReferenceSheetsArtifact } from './types.js';
import { ensureProjectWorkspace, type VideoProjectWorkspace } from './workspace.js';

export type FilmmakingPromptVariant =
  | 'character-sheet'
  | 'storyboard-grid'
  | 'text-driven'
  | 'storyboard-grid-reference'
  | 'character-sheets-plus-storyboard-grid';

export interface FilmmakingReferenceSlot {
  slot: string;
  role: 'character-sheet' | 'storyboard-grid' | 'start-frame' | 'end-frame' | 'reference-image';
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
  beat: string;
  cam: string;
  move: string;
  mood: string;
}

export interface FilmmakingStoryboardGridPrompt {
  variant: 'storyboard-grid';
  panelCount: 9;
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
    | 'seedance-music-default';
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
  write?: boolean;
}

export interface GenerateFilmmakingPromptsResult {
  artifact: FilmmakingPromptsArtifact;
  artifactPath?: string;
}

const STORYBOARD_POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const;

export async function generateFilmmakingPrompts(
  options: GenerateFilmmakingPromptsOptions,
): Promise<GenerateFilmmakingPromptsResult> {
  const root = options.root ?? process.cwd();
  const durationSeconds = options.durationSeconds ?? 15;
  const noFaces = options.noFaces ?? false;
  const workspace = await ensureProjectWorkspace(options.projectSlug, root);
  const brief = await readOptionalArtifact<BriefArtifact>(workspace, 'brief');
  const storyboard = await readOptionalArtifact<StoryboardArtifact>(workspace, 'storyboard');
  const assetManifest = await readOptionalArtifact<AssetManifestArtifact>(workspace, 'asset-manifest');
  const referenceSheets = await readReferenceSheetsArtifact(root, options.projectSlug);
  const characters = await listCharacterProfiles(workspace);
  const generatedAt = new Date().toISOString();
  const issues: FilmmakingPromptIssue[] = [];

  const referenceMap = buildReferenceMap(referenceSheets, characters, assetManifest);
  const characterSheetPrompts = buildCharacterSheetPrompts(characters, referenceMap, issues);
  const storyboardGridPrompt = storyboard
    ? buildStoryboardGridPrompt(storyboard, brief, characterSheetPrompts, noFaces)
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

  const seedancePackets = buildSeedancePackets({
    storyboard,
    brief,
    referenceMap,
    durationSeconds,
    noFaces,
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

function buildReferenceMap(
  referenceSheets: ReferenceSheetsArtifact,
  characters: CharacterProfile[],
  assetManifest: AssetManifestArtifact | undefined,
): FilmmakingReferenceSlot[] {
  const slots: FilmmakingReferenceSlot[] = [];
  for (const character of characters) {
    const identitySheet = findIdentitySheet(referenceSheets, character.name);
    const path = firstCharacterReference(character, identitySheet);
    slots.push({
      slot: nextSlot(slots.length),
      role: 'character-sheet',
      label: `${character.name} character sheet`,
      characterName: character.name,
      ...(path ? { path } : {}),
      status: path ? 'ready' : 'pending',
    });
  }

  for (const asset of assetManifest?.assets ?? []) {
    if (asset.kind !== 'image' || !Number.isInteger(asset.sceneIndex)) continue;
    if (slots.some((slot) => slot.path === asset.path && slot.sceneIndex === asset.sceneIndex)) continue;
    slots.push({
      slot: nextSlot(slots.length),
      role: 'start-frame',
      label: `Scene ${asset.sceneIndex} start frame`,
      path: asset.path,
      sceneIndex: asset.sceneIndex,
      status: 'ready',
    });
  }
  return slots;
}

function buildCharacterSheetPrompts(
  characters: CharacterProfile[],
  referenceMap: FilmmakingReferenceSlot[],
  issues: FilmmakingPromptIssue[],
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
    } else if (wordCount > 70) {
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
      promptText: mode === 'reference-image'
        ? characterSheetReferencePrompt(readySlots)
        : characterSheetDescriptionPrompt(description),
    };
  });
}

function buildStoryboardGridPrompt(
  storyboard: StoryboardArtifact,
  brief: BriefArtifact | undefined,
  characterPrompts: FilmmakingCharacterSheetPrompt[],
  noFaces = false,
): FilmmakingStoryboardGridPrompt {
  const panels = buildNinePanels(storyboard);
  const characters = characterPrompts
    .map((prompt) => `${prompt.characterName.toUpperCase()}: ${characterLine(prompt)}`)
    .join('\n');
  const sceneType = brief?.productionMode === 'director' ? 'cinematic director scene' : 'cinematic sequence';
  const location = brief?.title ?? storyboard.projectSlug;
  const styleLine = noFaces
    ? 'Style: Cinematic, production-grade, live-action, 35mm film grain. Render ALL figures as backlit silhouettes, shot from behind, or at distance — faces obscured, in shadow, or turned away, with NO clear frontal facial features (this keeps the sheet usable as a provider reference image despite real-person content filters). Aspect ratio = 16:9 page layout. No text, no captions, no panel numbers inside panels, only thin clean separators between panels. UNDER EACH panel a thin off-white annotation strip with three short lines of production notes in a clean, high-contrast sans-serif font: CAM, MOVE, and MOOD. Notes must read as short uppercase slug lines.'
    : 'Style: Cinematic, production-grade, live-action, photorealistic, lifelike, 35mm film grain. Aspect ratio = 16:9 page layout. No text, no captions, no panel numbers inside panels, only thin clean separators between panels. UNDER EACH panel a thin off-white annotation strip with three short lines of production notes in a clean, high-contrast sans-serif font: CAM, MOVE, and MOOD. Notes must read as short uppercase slug lines.';
  const promptText = [
    `Create a cinematic storyboard sheet in a 3x3 grid format (9 panels arranged in 3 rows x 3 columns) depicting ONE CONTINUOUS ${sceneType}.`,
    '',
    styleLine,
    '',
    'CHARACTER LOCK - all recurring characters must appear IDENTICAL across all 9 panels. Use the descriptions below as the source of truth.',
    characters || 'NO NAMED CHARACTER: preserve the same subject, setting, palette, and camera language across all panels.',
    '',
    `This is one continuous moment in ${location}. Same geography, same lighting logic, same wardrobe, same props. No extra characters, no readable UI text unless explicitly required, no logos unless already part of the brief.`,
    '',
    'Narrative - read left-to-right, top-to-bottom:',
    ...panels.map((panel) => (
      `Panel ${panel.panel} (${panel.position}): ${panel.beat}. CAM: ${panel.cam}. MOVE: ${panel.move}. MOOD: ${panel.mood}.`
    )),
  ].join('\n');
  return {
    variant: 'storyboard-grid',
    panelCount: 9,
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
  input.issues.push({
    code: 'seedance-music-default',
    severity: 'warning',
    message: 'Seedance packets default to NO MUSIC unless a scene prompt explicitly asks for music.',
  });
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
    return {
      sceneIndex: scene.sceneIndex,
      variant,
      durationSeconds: scene.durationSeconds ?? input.durationSeconds,
      references,
      promptText: seedancePromptText({
        scene,
        brief: input.brief,
        references,
        variant,
        durationSeconds: scene.durationSeconds ?? input.durationSeconds,
        noFaces: input.noFaces ?? false,
      }),
      warnings: references.filter((reference) => reference.status === 'pending')
        .map((reference) => `${reference.slot} ${reference.label} is pending.`),
    };
  });
}

// Positive-direction guard so the model performs the grid panels over time
// instead of reproducing the 3x3 collage as a moving split-screen frame.
// See multi-shot-framework Anti-patterns ("Grid leakage").
const GRID_SINGLE_FRAME_GUARD =
  'Output a single full-frame cinematic shot that fills the entire frame edge to edge — no 3x3 grid, no split-screen, no panel borders, no collage, no multi-panel montage. The storyboard grid is reference ONLY; perform its panels as consecutive moments over time, never as one image.';

function seedancePromptText(input: {
  scene: StoryboardArtifact['scenes'][number];
  brief: BriefArtifact | undefined;
  references: FilmmakingReferenceSlot[];
  variant: FilmmakingSeedancePacket['variant'];
  durationSeconds: number;
  noFaces?: boolean;
}): string {
  const characterRefs = input.references.filter((reference) => reference.role === 'character-sheet');
  const gridRef = input.references.find((reference) => reference.role === 'storyboard-grid');
  const startFrame = input.references.find((reference) => reference.role === 'start-frame');
  const duration = `${input.durationSeconds} seconds`;
  const action = cleanSentence(input.scene.scenePrompt?.animationPrompt ?? input.scene.description);
  const noFaceLine = input.noFaces
    ? 'Keep all figures as backlit silhouettes, backs, or distance with faces obscured (content-filter safe).'
    : '';
  if (input.variant === 'character-sheets-plus-storyboard-grid' && gridRef) {
    return [
      ...characterRefs.map((reference, index) => `Character ${index + 1}: ${reference.slot} (${reference.label})`),
      '',
      `Use the provided character sheets and cinematic storyboard grid ${gridRef.slot} as visual and motion reference. Create a ${duration} cinematic sequence. ${GRID_SINGLE_FRAME_GUARD} Follow the panel order, camera logic, motion, and framing consistently and temporally. NO TEXT ON SCREEN, NO MUSIC.`,
      noFaceLine,
      startFrame ? `Use ${startFrame.slot} as the scene start-frame continuity anchor.` : '',
      '',
      `Storyline: ${action}`,
    ].filter(Boolean).join('\n');
  }
  if (input.variant === 'storyboard-grid-reference' && gridRef) {
    return [
      `Use the provided cinematic storyboard grid ${gridRef.slot} as visual and motion reference. Create a ${duration} cinematic sequence. ${GRID_SINGLE_FRAME_GUARD} Follow the panel order, camera logic, motion and camera framing consistently. Handheld camera moments may be used to boost realism. NO TEXT ON SCREEN, NO MUSIC.`,
      noFaceLine,
      startFrame ? `Use ${startFrame.slot} as the scene start-frame continuity anchor.` : '',
      '',
      `Storyline: ${action}`,
    ].filter(Boolean).join('\n');
  }
  return [
    `FORMAT: ${duration} / 3 CUTS / cinematic grounded realism / NO MUSIC`,
    '',
    input.scene.characters?.length ? `SUBJECT: ${input.scene.characters.join(', ')}.` : 'SUBJECT: Primary subject from the storyboard scene.',
    `ENVIRONMENT: ${input.brief?.title ?? input.brief?.intent ?? input.scene.description}.`,
    'AUDIO / MOOD: No music. Natural ambience and subject-driven sound only.',
    '',
    `TIMELINE (must cover full 0:00-${formatSeconds(input.durationSeconds)}):`,
    `0:00-${formatSeconds(Math.floor(input.durationSeconds / 3))}: Wide establishing shot - ${action}.`,
    `${formatSeconds(Math.floor(input.durationSeconds / 3))}-${formatSeconds(Math.floor((input.durationSeconds * 2) / 3))}: Medium shot - preserve subject identity and geography while the action develops.`,
    `${formatSeconds(Math.floor((input.durationSeconds * 2) / 3))}-${formatSeconds(input.durationSeconds)}: Close-up or resolved final frame - complete the scene beat cleanly.`,
  ].join('\n');
}

function characterSheetReferencePrompt(referenceSlots: string[]): string {
  return `Create a professional character reference sheet for the attached character using ${referenceSlots.join(', ')} as strong reference, 1:1 similarity, photorealistic live-action style. Divide the sheet into four vertical columns for a total of eight shots. The top row shows full-body views from head to toe: front, side, three-quarter, and back. No cropping at ankles, knees, or head. The bottom row contains four matching face close-ups, including front and profile views. Use clean neutral studio lighting. Background should be simple and not distracting from character design. Aspect ratio = 16:9.`;
}

function characterSheetDescriptionPrompt(description: string): string {
  return `Create a professional character reference sheet for ${description}. Divide the sheet into four vertical columns for a total of eight shots. The top row shows full-body views from head to toe: front, side, three-quarter, and back. No cropping at ankles, knees, or head. The bottom row contains four matching face close-ups, including front and profile views. Use photorealistic live-action style, clean neutral studio lighting, natural skin tones, no scene-specific lighting. Background should be simple and not distracting from character design. Aspect ratio = 16:9.`;
}

function buildNinePanels(storyboard: StoryboardArtifact): FilmmakingStoryboardPanel[] {
  const scenes = storyboard.scenes.length > 0 ? storyboard.scenes : [{
    sceneIndex: 0,
    description: 'Opening visual beat',
  }];
  return STORYBOARD_POSITIONS.map((position, index) => {
    const scene = scenes[Math.min(index, scenes.length - 1)];
    return {
      panel: index + 1,
      position,
      beat: shortBeat(scene.description, index, scenes.length),
      cam: cameraLine(index),
      move: moveLine(scene.description),
      mood: moodLine(index, scenes.length),
    };
  });
}

function shortBeat(value: string, index: number, sceneCount: number): string {
  const cleaned = cleanSentence(value).split(/\s+/).slice(0, 12).join(' ');
  if (index >= sceneCount) return `Resolved echo of ${cleaned.toLowerCase()}`;
  return cleaned;
}

function cameraLine(index: number): string {
  return [
    'WIDE. LOW TRACK',
    'MEDIUM. WHIP PAN',
    'CLOSE. STATIC',
    'OVER SHOULDER. PUSH',
    'WIDE. SLOW ORBIT',
    'MEDIUM CLOSE. HANDHELD',
    'LOW ANGLE. PUSH IN',
    'PROFILE. TRACK',
    'CLOSE. SOFT HOLD',
  ][index] ?? 'MEDIUM. STATIC';
}

function moveLine(description: string): string {
  return cleanSentence(description).split(/\s+/).slice(0, 6).join(' ').toUpperCase();
}

function moodLine(index: number, sceneCount: number): string {
  if (index === 0) return 'ESTABLISH. CONTROLLED.';
  if (index >= sceneCount - 1) return 'PAYOFF. RESOLVE.';
  return 'BUILD. CONTINUITY.';
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
