/**
 * Detail-leveled camera / lighting / grade emitters.
 *
 * Pure, deterministic prompt-fragment builders. No I/O, no network.
 * Each emitter turns a structured spec into a human/provider-readable
 * string whose density scales with the requested {@link DetailLevel}:
 *   - terse:    evocative words only, no numbers
 *   - standard: key numeric anchors (lens, Kelvin, ratio)
 *   - rich:     full numeric detail (velocity, fill/rim, hue/sat splits)
 */

export type DetailLevel = 'terse' | 'standard' | 'rich';

export type CameraMovement =
  | 'push-in'
  | 'pull-out'
  | 'dolly'
  | 'orbit'
  | 'pan'
  | 'tilt'
  | 'track'
  | 'handheld'
  | 'locked-off';

export interface CameraMove {
  shot: string;
  lens: number;
  angle: string;
  movement: CameraMovement;
  velocityFtPerSec?: number;
}

interface LightingPreset {
  kelvin: number;
  keyDeg: number;
  ratio: string;
}

interface GradePreset {
  shadowHue: number;
  shadowSat: number;
  highlightHue: number;
  highlightSat: number;
}

const DEFAULT_VELOCITY: Record<CameraMovement, number> = {
  'push-in': 2,
  'pull-out': 2,
  dolly: 3,
  orbit: 4,
  pan: 5,
  tilt: 4,
  track: 6,
  handheld: 3,
  'locked-off': 0,
};

const MOVEMENT_QUALIFIER: Record<CameraMovement, string> = {
  'push-in': 'slow push-in',
  'pull-out': 'slow pull-out',
  dolly: 'smooth dolly',
  orbit: 'steady orbit',
  pan: 'controlled pan',
  tilt: 'controlled tilt',
  track: 'tracking move',
  handheld: 'loose handheld',
  'locked-off': 'locked-off, no movement',
};

const LIGHTING: Record<string, LightingPreset> = {
  'hard-dawn': { kelvin: 4200, keyDeg: 25, ratio: '4:1' },
  'golden-hour': { kelvin: 3200, keyDeg: 15, ratio: '3:1' },
  'neutral-studio': { kelvin: 5600, keyDeg: 45, ratio: '2:1' },
  'night-fire': { kelvin: 2000, keyDeg: 30, ratio: '8:1' },
};

const LIGHTING_WORDS: Record<string, string> = {
  'hard-dawn': 'crisp directional dawn light, long raking shadows',
  'golden-hour': 'warm low golden-hour glow, soft long shadows',
  'neutral-studio': 'clean balanced studio light, even and neutral',
  'night-fire': 'flickering warm firelight against deep night shadow',
};

const GRADE: Record<string, GradePreset> = {
  'desaturated-earth': { shadowHue: 30, shadowSat: 18, highlightHue: 45, highlightSat: 22 },
  'teal-orange': { shadowHue: 190, shadowSat: 45, highlightHue: 30, highlightSat: 55 },
  'noir-bw': { shadowHue: 0, shadowSat: 0, highlightHue: 0, highlightSat: 0 },
};

const GRADE_WORDS: Record<string, string> = {
  'desaturated-earth': 'muted earthy palette, dusty and restrained',
  'teal-orange': 'cinematic teal-and-orange contrast',
  'noir-bw': 'high-contrast monochrome noir',
};

/**
 * Build a camera-move prompt fragment at the requested detail level.
 */
export function cameraSpec(m: CameraMove, d: DetailLevel): string {
  const base = `${m.shot}, ${m.angle} angle, ${m.movement}`;
  if (d === 'terse') {
    return base;
  }
  if (d === 'standard') {
    return `${m.shot}, ${m.angle} angle, ${m.lens}mm, ${MOVEMENT_QUALIFIER[m.movement]}`;
  }
  const velocity = m.velocityFtPerSec ?? DEFAULT_VELOCITY[m.movement];
  return (
    `${m.shot}, ${m.angle} angle, ${m.lens}mm, ` +
    `${m.movement} at ${velocity} ft/s, subtle lens breathing`
  );
}

/**
 * Build a lighting prompt fragment at the requested detail level.
 * Unknown ids fall back to a neutral string rather than throwing.
 */
export function lightingSpec(id: string, d: DetailLevel): string {
  const preset = LIGHTING[id];
  if (!preset) {
    if (d === 'terse') {
      return 'soft neutral lighting';
    }
    return '5600K key at 45°, 2:1 ratio, neutral fill';
  }
  const words = LIGHTING_WORDS[id] ?? id;
  if (d === 'terse') {
    return words;
  }
  const core = `${preset.kelvin}K key at ${preset.keyDeg}°, ${preset.ratio} ratio`;
  if (d === 'standard') {
    return core;
  }
  return `${core}, gentle fill and crisp rim light, ${words}`;
}

/**
 * Build a color-grade prompt fragment at the requested detail level.
 * Unknown ids fall back to a neutral string rather than throwing.
 */
export function gradeSpec(id: string, d: DetailLevel): string {
  const preset = GRADE[id];
  if (!preset) {
    if (d === 'terse') {
      return 'neutral grade';
    }
    if (d === 'standard') {
      return 'balanced neutral grade, natural contrast';
    }
    return 'shadows 0° 0% neutral; highlights 0° 0% neutral, natural contrast';
  }
  const words = GRADE_WORDS[id] ?? id;
  if (d === 'terse') {
    return words;
  }
  if (d === 'standard') {
    return `${words} grade`;
  }
  return (
    `shadows ${preset.shadowHue}° ${preset.shadowSat}% tint; ` +
    `highlights ${preset.highlightHue}° ${preset.highlightSat}% tint, ${words}`
  );
}
