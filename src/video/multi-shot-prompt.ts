import { readFile } from 'node:fs/promises';
import {
  CAMERA_MOVE_VOCABULARY,
  SHOT_TYPE_VOCABULARY,
  SHOT_SIZE_VOCABULARY,
  LENS_VOCABULARY,
  ANGLE_VOCABULARY,
} from './prompt-quality.js';

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

export { SHOT_SIZES, LENSES, ANGLES, MOVEMENTS, SHOT_TYPE_VOCABULARY };

// Authors a finished prompt body. When VCLAW_MULTISHOT_AUTO_STUB points to a file,
// its contents are returned verbatim (test/offline path). Otherwise calls Gemini.
export async function generateMultiShotPromptText(input: {
  preset: MultiShotPreset;
  imagePath: string;
  character?: string;
  action?: string;
  location: string;
  timeOfDay: string;
}): Promise<string> {
  const stub = process.env.VCLAW_MULTISHOT_AUTO_STUB;
  if (stub) {
    return (await readFile(stub, 'utf-8')).trim();
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
  });
}
