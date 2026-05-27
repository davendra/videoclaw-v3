import { CAMERA_MOVE_VOCABULARY, SHOT_TYPE_VOCABULARY } from './prompt-quality.js';

export interface MultiShotPreset {
  name: string;
  totalSeconds: number;
  minShotSeconds: number;
  maxShotSeconds: number;
  maxChars: number;
  styleLine: string;
  audioLine: string;
}

export const CINEMATIC_15S_PRESET: MultiShotPreset = {
  name: 'cinematic-15s',
  totalSeconds: 15,
  minShotSeconds: 2,
  maxShotSeconds: 5,
  maxChars: 1500,
  styleLine:
    'Cool shadows, natural skin tones. IMAX-scale composition, deep focus, practical lighting. High contrast, grounded realism. In the style of a Christopher Nolan movie.',
  audioLine:
    'Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.',
};

// Suggested camera-grid vocabularies. Shot sizes/angles/lenses are local to the
// framework; prompt-quality's SHOT_TYPE_VOCABULARY is only re-exported for
// consumers (it is not used when building the plan — SHOT_SIZES is).
const SHOT_SIZES = ['wide', 'medium', 'medium close-up', 'close-up', 'macro'] as const;
const LENSES = ['24mm', '35mm', '50mm', '85mm'] as const;
const ANGLES = ['low angle', 'high angle', 'eye-level', 'over-the-shoulder', 'Dutch angle'] as const;
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
  const minCount = Math.max(3, Math.ceil(preset.totalSeconds / preset.maxShotSeconds));
  const maxCount = Math.min(7, Math.floor(preset.totalSeconds / preset.minShotSeconds));
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
