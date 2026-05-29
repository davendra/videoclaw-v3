import { readFile } from 'node:fs/promises';
import {
  CAMERA_MOVE_VOCABULARY,
  SHOT_TYPE_VOCABULARY,
  SHOT_SIZE_VOCABULARY,
  LENS_VOCABULARY,
  ANGLE_VOCABULARY,
} from './prompt-quality.js';
import type { CategoryDescriptor } from './category-registry.js';

export interface MultiShotPreset {
  name: string;
  totalSeconds: number;
  minShotSeconds: number;
  maxShotSeconds: number;
  minShots: number;
  maxShots: number;
  maxChars: number;
  styleLine: string;
  audioLine: string;
}

export const CINEMATIC_15S_PRESET: MultiShotPreset = {
  name: 'cinematic-15s',
  totalSeconds: 15,
  minShotSeconds: 2,
  maxShotSeconds: 5,
  minShots: 3,
  maxShots: 7,
  maxChars: 1500,
  styleLine:
    'Cool shadows, natural skin tones. IMAX-scale composition, deep focus, practical lighting. High contrast, grounded realism. In the style of a Christopher Nolan movie.',
  audioLine:
    'Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.',
};

export const SEEDANCE_10S_PRESET: MultiShotPreset = {
  name: 'seedance-10s',
  totalSeconds: 10,
  minShotSeconds: 2,
  maxShotSeconds: 5,
  minShots: 2,
  maxShots: 5,
  maxChars: 1500,
  styleLine: CINEMATIC_15S_PRESET.styleLine,
  audioLine: CINEMATIC_15S_PRESET.audioLine,
};

export const VEO_8S_PRESET: MultiShotPreset = {
  name: 'veo-8s',
  totalSeconds: 8,
  minShotSeconds: 2,
  maxShotSeconds: 4,
  minShots: 2,
  maxShots: 4,
  maxChars: 1500,
  styleLine: CINEMATIC_15S_PRESET.styleLine,
  audioLine: CINEMATIC_15S_PRESET.audioLine,
};

export const RUNWAY_10S_PRESET: MultiShotPreset = {
  name: 'runway-10s',
  totalSeconds: 10,
  minShotSeconds: 2,
  maxShotSeconds: 5,
  minShots: 2,
  maxShots: 5,
  maxChars: 1000,
  styleLine: CINEMATIC_15S_PRESET.styleLine,
  audioLine: CINEMATIC_15S_PRESET.audioLine,
};

const PRESET_REGISTRY: ReadonlyMap<string, MultiShotPreset> = new Map([
  [CINEMATIC_15S_PRESET.name, CINEMATIC_15S_PRESET],
  [SEEDANCE_10S_PRESET.name, SEEDANCE_10S_PRESET],
  [VEO_8S_PRESET.name, VEO_8S_PRESET],
  [RUNWAY_10S_PRESET.name, RUNWAY_10S_PRESET],
]);

export function knownPresetNames(): readonly string[] {
  return Array.from(PRESET_REGISTRY.keys());
}

// Provider/route hint → preset, keyed on the provider FAMILY (the first token of
// the hint, e.g. `seedance-direct` → `seedance`, `veo-useapi` → `veo`,
// `google-flow` → `google`). Matching the family token rather than a substring
// avoids misfires like `veo-via-runway-proxy` resolving to runway, and keeps the
// mapping next to the preset registry it points at — the single source of truth.
const PROVIDER_FAMILY_PRESET: ReadonlyMap<string, string> = new Map([
  ['seedance', SEEDANCE_10S_PRESET.name],
  ['veo', VEO_8S_PRESET.name],
  ['google', VEO_8S_PRESET.name],
  ['flow', VEO_8S_PRESET.name],
  ['runway', RUNWAY_10S_PRESET.name],
]);

export function presetNameForProvider(hint: string | undefined): string | undefined {
  if (!hint) return undefined;
  const family = hint.trim().toLowerCase().split(/[-_:/\s]/)[0];
  return PROVIDER_FAMILY_PRESET.get(family);
}

export function listMultiShotPresets(): readonly MultiShotPreset[] {
  return Array.from(PRESET_REGISTRY.values());
}

export function resolvePreset(name?: string): MultiShotPreset {
  if (name === undefined) return CINEMATIC_15S_PRESET;
  const preset = PRESET_REGISTRY.get(name);
  if (!preset) {
    throw new Error(
      `unknown preset "${name}" (known: ${knownPresetNames().join(', ')})`,
    );
  }
  return preset;
}

// Suggested camera-grid vocabularies. Shot sizes/angles/lenses are local to the
// framework; prompt-quality's SHOT_TYPE_VOCABULARY is only re-exported for
// consumers (it is not used when building the plan — SHOT_SIZES is).
const SHOT_SIZES = SHOT_SIZE_VOCABULARY;
const LENSES = LENS_VOCABULARY;
const ANGLES = ANGLE_VOCABULARY;
const MOVEMENTS = CAMERA_MOVE_VOCABULARY;

export interface ShotSlot {
  index: number;
  start: number;
  end: number;
  timecode: string;
  shotSize: string;
  lens: string;
  angle: string;
  movement: string;
}

export interface ParsedMultiShotShot extends ShotSlot {
  description: string;
}

export interface ShotPlan {
  preset: MultiShotPreset;
  shots: ShotSlot[];
}

export interface BuildShotPlanOptions {
  shots?: number;
  seed?: number;
}

// Deterministic, seedable PRNG so plans vary across calls but are reproducible in tests.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTimecode(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

// Partition totalSeconds into `count` integer durations, each within [min, max].
function partitionDurations(
  total: number,
  count: number,
  min: number,
  max: number,
  rand: () => number,
): number[] {
  if (count * min > total || count * max < total) {
    throw new Error(
      `cannot partition ${total}s into ${count} shots within [${min}, ${max}]`,
    );
  }
  const durations = new Array(count).fill(min);
  let remaining = total - count * min;
  const open = durations.map((_, i) => i); // indices still below max
  while (remaining > 0) {
    const pick = Math.floor(rand() * open.length);
    const i = open[pick];
    durations[i] += 1;
    remaining -= 1;
    if (durations[i] >= max) open.splice(pick, 1);
  }
  return durations;
}

function pickNonRepeating<T>(pool: readonly T[], prev: T | undefined, rand: () => number): T {
  if (pool.length === 1) return pool[0];
  const candidates = prev === undefined ? pool : pool.filter((v) => v !== prev);
  return candidates[Math.floor(rand() * candidates.length)];
}

export function buildShotPlan(
  preset: MultiShotPreset,
  options: BuildShotPlanOptions = {},
): ShotPlan {
  const rand = mulberry32(options.seed ?? Math.floor(Math.random() * 1e9));
  const arithMin = Math.ceil(preset.totalSeconds / preset.maxShotSeconds);
  const arithMax = Math.floor(preset.totalSeconds / preset.minShotSeconds);
  const minCount = Math.max(preset.minShots, arithMin);
  const maxCount = Math.min(preset.maxShots, arithMax);
  if (minCount > maxCount) {
    throw new Error(
      `preset "${preset.name}": shot-count window [${preset.minShots}, ${preset.maxShots}] cannot satisfy duration partition [${arithMin}, ${arithMax}]`,
    );
  }
  let count = options.shots ?? minCount + Math.floor(rand() * (maxCount - minCount + 1));
  // Clamp to [minCount, maxCount] so an explicit --shots stays feasible.
  if (count < minCount) count = minCount;
  if (count > maxCount) count = maxCount;

  const durations = partitionDurations(
    preset.totalSeconds,
    count,
    preset.minShotSeconds,
    preset.maxShotSeconds,
    rand,
  );

  const shots: ShotSlot[] = [];
  let cursor = 0;
  let prevSize: string | undefined;
  let prevLens: string | undefined;
  let prevAngle: string | undefined;
  let prevMove: string | undefined;
  for (let i = 0; i < count; i += 1) {
    const start = cursor;
    const end = cursor + durations[i];
    cursor = end;
    const shotSize = pickNonRepeating(SHOT_SIZES, prevSize, rand);
    const lens = pickNonRepeating(LENSES, prevLens, rand);
    const angle = pickNonRepeating(ANGLES, prevAngle, rand);
    const movement = pickNonRepeating(MOVEMENTS, prevMove, rand);
    prevSize = shotSize;
    prevLens = lens;
    prevAngle = angle;
    prevMove = movement;
    shots.push({
      index: i,
      start,
      end,
      timecode: `[${formatTimecode(start)} - ${formatTimecode(end)}]`,
      shotSize,
      lens,
      angle,
      movement,
    });
  }
  return { preset, shots };
}

export function assembleMetadataBlock(
  preset: MultiShotPreset,
  location: string,
  timeOfDay: string,
): string {
  const loc = timeOfDay ? `${location}, ${timeOfDay}` : location;
  return [
    `Location: ${loc}`,
    `Style: ${preset.styleLine}`,
    `Audio: ${preset.audioLine}`,
  ].join('\n');
}

// Compose a full prompt body from a plan whose shots already carry `description`.
export function composePromptText(
  plan: Array<Pick<ShotSlot, 'timecode'> & { line: string }>,
  metadataBlock: string,
): string {
  const body = plan.map((s) => `${s.timecode} ${s.line}`).join('\n\n');
  return `${body}\n\n${metadataBlock}`;
}

// Render a ShotPlan in Seedance's native prompt format: one flowing paragraph
// with inline labeled segments (Style & Mood / Dynamic Description / Static
// Description), a camera block in the existing per-shot emitter phrasing, and an
// Audio footer. Pure and deterministic — it only reads `plan`/`descriptor`.
export function composeSeedanceParagraph(
  plan: ShotPlan,
  descriptor: CategoryDescriptor,
): string {
  const { preset, shots } = plan;
  // Camera block: reuse the per-shot "shotSize, lens, angle, movement" phrasing,
  // collapsed onto one line so the paragraph stays a single block.
  const cameraBlock = shots
    .map((s) => `${s.shotSize}, ${s.lens}, ${s.angle}, ${s.movement}`)
    .join('; ');
  const motion = shots.map((s) => s.movement).join(', ');
  const styleMood = `${descriptor.label} — ${preset.styleLine}`;
  const dynamic = `the ${descriptor.subjectType} carries the action across ${shots.length} continuous beats (${motion})`;
  const staticScene = `${descriptor.label} scene, ${descriptor.genre} look, beat structure ${descriptor.beatTemplate}`;
  const segments = [
    `Style & Mood: ${styleMood}`,
    `Dynamic Description: ${dynamic}`,
    `Static Description: ${staticScene}`,
    `Camera: ${cameraBlock}`,
    `Audio: ${preset.audioLine}`,
  ];
  // Single space joins keep this one flowing paragraph (no "\n\n" block breaks).
  return segments.join(' ');
}

// Render a ShotPlan as a structured per-shot video-prompt layout: one block per
// shot headed `SHOT <N> — <NAME>`, followed by labeled lines (Framing / Scene /
// Dialogue / SFX / Camera), closed by a single Audio footer from the preset.
// Blocks are separated by blank lines. Pure and deterministic — it only reads
// `plan`/`descriptor`. ShotSlot carries no per-shot name/scene/dialogue/sfx
// fields, so those are derived deterministically (NAME falls back to the shot
// size, then `Shot <N>`; Dialogue/SFX render an em-dash placeholder when absent).
export function composePerShotFormat(
  plan: ShotPlan,
  descriptor: CategoryDescriptor,
): string {
  const { preset, shots } = plan;
  const blocks = shots.map((s, i) => {
    const n = i + 1;
    const name = s.shotSize || `Shot ${n}`;
    const framing = `${s.shotSize}, ${s.angle}, ${s.movement}, ${s.lens}`;
    const scene = `${descriptor.label} — ${descriptor.subjectType} carries beat ${n} of ${shots.length} (${s.movement}); ${descriptor.genre} look, ${descriptor.beatTemplate} structure`;
    return [
      `SHOT ${n} — ${name}`,
      `Framing: ${framing}`,
      `Scene: ${scene}`,
      `Dialogue: —`,
      `SFX: —`,
      `Camera: ${s.movement}`,
    ].join('\n');
  });
  return `${blocks.join('\n\n')}\n\nAudio: ${preset.audioLine}`;
}

export interface DialogueLine {
  speaker: string;
  line: string;
  emotion?: string;
  secondSpeaker?: { speaker: string; line: string; emotion?: string };
}

// Append spoken dialogue to a shot line using a clean two-speaker convention.
// The first speaker gets a "<speaker> says[, <emotion>]:" opener; a second
// speaker (when present) gets exactly one "<speaker> replies[, <emotion>]:"
// opener. Pure and deterministic — no randomness or clock reads.
export function withDialogue(shotLine: string, dialogue: DialogueLine): string {
  const firstOpener = dialogue.emotion
    ? `${dialogue.speaker} says, ${dialogue.emotion}:`
    : `${dialogue.speaker} says:`;
  const segments = [shotLine, `${firstOpener} "${dialogue.line}"`];
  if (dialogue.secondSpeaker) {
    const { speaker, line, emotion } = dialogue.secondSpeaker;
    const replyOpener = emotion ? `${speaker} replies, ${emotion}:` : `${speaker} replies:`;
    segments.push(`${replyOpener} "${line}"`);
  }
  return segments.join(' ');
}

export { SHOT_SIZES, LENSES, ANGLES, MOVEMENTS, SHOT_TYPE_VOCABULARY };

let stubSequenceIndex = 0;

// Brackets stay required (anchors the match so prose containing a "12:30" time
// isn't parsed as a shot), but accept ASCII hyphen / en-dash / em-dash and
// 1-2 digit minutes so a valid Gemini prompt isn't silently parsed to zero shots.
const TIMECODE_LINE_RE = /^\s*\[(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})\]\s*(.*)$/;

function secondsFromParts(mm: string, ss: string): number {
  return Number(mm) * 60 + Number(ss);
}

function findCanonicalTerm(haystack: string, pool: readonly string[]): string {
  const normalizedHaystack = haystack.toLowerCase().replace(/-/g, ' ');
  for (const term of [...pool].sort((a, b) => b.length - a.length)) {
    const normalizedTerm = term.toLowerCase().replace(/-/g, ' ');
    if (normalizedHaystack.includes(normalizedTerm)) return term;
  }
  return '';
}

function stripShotLead(text: string): string {
  const dashIndex = text.search(/\s[—–-]\s/);
  if (dashIndex >= 0) {
    return text.slice(dashIndex + 3).trim();
  }
  return text
    .replace(/^(?:[^,.]+,\s*){1,4}/, '')
    .replace(/^[:.]\s*/, '')
    .trim();
}

export function parseMultiShotPrompt(promptText: string): ParsedMultiShotShot[] {
  const shots: ParsedMultiShotShot[] = [];
  const lines = promptText.split('\n').filter((line) => line.trim().length > 0);
  for (const line of lines) {
    const match = TIMECODE_LINE_RE.exec(line);
    if (!match) continue;
    const start = secondsFromParts(match[1], match[2]);
    const end = secondsFromParts(match[3], match[4]);
    const body = match[5].trim();
    shots.push({
      index: shots.length,
      start,
      end,
      timecode: `[${formatTimecode(start)} - ${formatTimecode(end)}]`,
      shotSize: findCanonicalTerm(body, SHOT_SIZES),
      lens: findCanonicalTerm(body, LENSES),
      angle: findCanonicalTerm(body, ANGLES),
      movement: findCanonicalTerm(body, MOVEMENTS),
      description: stripShotLead(body),
    });
  }
  return shots;
}

// Authors a finished prompt body. When VCLAW_MULTISHOT_AUTO_STUB points to a file,
// its contents are returned verbatim (test/offline path). Otherwise calls Gemini.
export async function generateMultiShotPromptText(input: {
  preset: MultiShotPreset;
  imagePath: string;
  character?: string;
  action?: string;
  location: string;
  timeOfDay: string;
  repairInstructions?: string;
}): Promise<string> {
  const stub = process.env.VCLAW_MULTISHOT_AUTO_STUB;
  if (stub) {
    const raw = (await readFile(stub, 'utf-8')).trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        // A call with no repairInstructions is the first attempt of a fresh
        // generation sequence, so reset the cursor. Retries (repairInstructions
        // present) advance through the array. This keeps the module-global index
        // from bleeding across independent in-process generations.
        if (!input.repairInstructions) stubSequenceIndex = 0;
        const item = parsed[Math.min(stubSequenceIndex, parsed.length - 1)];
        stubSequenceIndex += 1;
        return item.trim();
      }
    } catch {
      // Plain-text stubs remain the default offline path.
    }
    return raw;
  }
  // Real path: delegate to the shared Gemini analyze plumbing. Dynamic import so
  // the Gemini module is only loaded on the live path (avoids a static import edge).
  const { generateMultiShotWithGemini } = await import('./gemini-analyze.js');
  return generateMultiShotWithGemini({
    preset: input.preset,
    imagePath: input.imagePath,
    character: input.character,
    action: input.action,
    location: input.location,
    timeOfDay: input.timeOfDay,
    repairInstructions: input.repairInstructions,
  });
}
