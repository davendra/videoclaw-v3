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

/**
 * A fully-specified cinema mode: the camera-worldbuilder backbone.
 *
 * Each field is a self-contained prompt fragment describing one axis of
 * the look, so a caller can assemble a mode into a coherent shot recipe.
 */
export interface ModeSpec {
  camera: string;
  lens: string;
  movement: string;
  filtration: string;
  grade: string;
}

/**
 * The five canonical cinema modes. Order is intentional (narrative first,
 * as the safe fallback); tests assert the sorted set.
 */
export const CINEMA_MODE_IDS = ['narrative', 'studio', 'action', 'performance', 'atmospheric'] as const;

export type CinemaModeId = (typeof CINEMA_MODE_IDS)[number];

const CINEMA_MODES: Record<CinemaModeId, ModeSpec> = {
  narrative: {
    camera: 'lived-in real-world coverage, motivated framing, naturalistic eyelines',
    lens: '35mm spherical primes, shallow-to-medium depth',
    movement: 'grounded handheld and dolly, motivated reframes',
    filtration: 'light black pro-mist 1/8, subtle halation on practicals',
    grade: 'natural skin, gentle filmic contrast, true-to-life palette',
  },
  studio: {
    camera: 'crafted void backdrop, controlled tabletop framing, precise composition',
    lens: '50mm macro-capable primes, deep controlled focus',
    movement: 'locked-off and motorized slider, perfectly repeatable moves',
    filtration: 'clean uncoated glass, no diffusion, crisp specular highlights',
    grade: 'clean neutral base, controlled contrast, accurate product color',
  },
  action: {
    camera: 'kinetic handheld with whip-pans, fast aggressive coverage, dynamic angles',
    lens: '24mm wide primes, fast apertures for snap focus',
    movement: 'fast handheld, whip-pan and crash-zoom, rapid tracking',
    filtration: 'minimal diffusion, hard contrast, occasional anamorphic flare',
    grade: 'punchy high-contrast teal-and-orange, crushed shadows',
  },
  performance: {
    camera: 'pit-photographer documentary framing, long-lens isolation, candid energy',
    lens: '85–135mm telephoto, compressed perspective, creamy bokeh',
    movement: 'shoulder-rig follow and long-lens pans, reactive not planned',
    filtration: 'glimmerglass 1/4 for stage glow, gentle bloom on lights',
    grade: 'saturated stage color, warm highlights, rich contrast',
  },
  atmospheric: {
    camera: 'slow environmental wides, mood-led negative space, patient framing',
    lens: '40mm primes, soft falloff, atmospheric depth',
    movement: 'slow creeping push-in and drifting glide, near-static',
    filtration: 'heavy black pro-mist 1/4, volumetric haze, soft bloom',
    grade: 'desaturated moody palette, cool shadows, low-key contrast',
  },
};

/**
 * Resolve a cinema mode by id, falling back to `narrative` for unknown
 * ids rather than throwing.
 */
export function cinemaMode(id: CinemaModeId): ModeSpec {
  return CINEMA_MODES[id] ?? CINEMA_MODES.narrative;
}

const ORBIT_MODE: ModeSpec = {
  camera: 'orbiting hero framing, subject centered as the camera arcs around it',
  lens: '50mm primes, medium depth holding the subject sharp through the arc',
  movement: 'smooth 360° orbit, steady circular tracking around the subject',
  filtration: 'light black pro-mist 1/8, clean specular highlights',
  grade: 'rich contrast, controlled color, hero-product polish',
};

const VOCAB_TO_MODE: Record<string, CinemaModeId> = {
  cinematic: 'narrative',
  'handheld-social': 'action',
  macro: 'studio',
  glide: 'atmospheric',
  stylized: 'performance',
};

/**
 * Map a {@link CategoryDescriptor} `cameraVocab` token onto a {@link ModeSpec}.
 *
 * `orbit` resolves to a synthesized orbit spec; other known tokens map to a
 * canonical mode. Unknown tokens fall back to `narrative` rather than throwing.
 */
export function resolveCameraVocab(vocab: string): ModeSpec {
  if (vocab === 'orbit') {
    return ORBIT_MODE;
  }
  const mode = VOCAB_TO_MODE[vocab];
  return mode ? CINEMA_MODES[mode] : CINEMA_MODES.narrative;
}

/**
 * One stacked shot in a multi-world intercut sequence: a single shot that
 * carries its OWN cinema-mode {@link ModeSpec} and a rendered camera `block`.
 */
export interface StackedShot {
  modeId: CinemaModeId;
  spec: ModeSpec;
  block: string;
}

/**
 * Render a {@link ModeSpec} as a single-line camera block string. The
 * `spec.camera` fragment is preserved verbatim so callers (and tests) can
 * locate it inside the block.
 */
function renderModeBlock(spec: ModeSpec): string {
  return `CAM: ${spec.camera} | ${spec.lens} | ${spec.movement} | ${spec.filtration} | ${spec.grade}`;
}

/**
 * Stack cinema modes for a multi-world intercut sequence.
 *
 * Returns one {@link StackedShot} per input mode id, preserving input order
 * AND duplicates. Each shot keeps its OWN {@link cinemaMode} spec and rendered
 * camera block — adjacent modes are never averaged, merged, or collapsed into
 * a single register, so intercutting between worlds stays visually distinct.
 */
export function stackModes(modeIds: CinemaModeId[]): StackedShot[] {
  return modeIds.map((modeId) => {
    const spec = cinemaMode(modeId);
    return { modeId, spec, block: renderModeBlock(spec) };
  });
}

/**
 * The named 2-second hook patterns: scroll-stopping opening beats. Order is
 * intentional and stable; callers may iterate {@link HOOK_PATTERN_IDS}.
 */
export const HOOK_PATTERN_IDS = [
  'black-to-light',
  'silence-to-sound',
  'reverse-motion',
  'beat-drop',
  'match-cut-in',
  'whip-reveal',
] as const;

export type HookPatternId = (typeof HOOK_PATTERN_IDS)[number];

const HOOK_PATTERNS: Record<HookPatternId, string> = {
  'black-to-light':
    'Hard cut from black to a blinding light burst that resolves into the hero subject, irises adjusting as detail floods in.',
  'silence-to-sound':
    'Dead silence over a held still frame, then a sudden full-bandwidth sound hit lands as the image snaps into motion.',
  'reverse-motion':
    'Action plays in eerie reverse — debris, liquid, and fabric rushing back into place — before it whips forward into real time.',
  'beat-drop':
    'Rapid pre-roll build with quick-cut teases that freeze on the downbeat, then explode into the full scene on the drop.',
  'match-cut-in':
    'A graphic match cut carries a shape, motion, or color straight from an everyday object into the hero subject in one seamless jump.',
  'whip-reveal':
    'A fast whip-pan smears the frame into motion blur, then decelerates hard to reveal the hero subject dead-center.',
};

/**
 * Pad an integer second count to a 2-digit string (assumes < 60).
 */
function padSeconds(seconds: number): string {
  return String(seconds).padStart(2, '0');
}

/**
 * Render a named 2-second opening hook as a timecoded beat.
 *
 * Returns `"[00:00 - 00:0N] <description>"` where `N` is `hookSeconds`
 * (zero-padded, assumed < 60). Unlike the cinema-mode resolvers, an unknown
 * pattern id THROWS rather than falling back — hooks must be explicit.
 */
export function hookBeat(pattern: HookPatternId, hookSeconds: number): string {
  const description = HOOK_PATTERNS[pattern];
  if (!description) {
    throw new Error(`unknown hook pattern: ${pattern}`);
  }
  return `[00:00 - 00:${padSeconds(hookSeconds)}] ${description}`;
}

/**
 * Per-genre look defaults: concrete color / lighting / cut-rate anchors a
 * caller can seed a shot plan with before any per-shot overrides.
 *
 * `keyLightId` references an id understood by {@link lightingSpec}
 * (e.g. `'neutral-studio'`, `'golden-hour'`, `'hard-dawn'`, `'night-fire'`).
 */
export interface GenreDefaults {
  paletteHue: number;
  saturationPct: number;
  cutRatePerSec: number;
  keyLightId: string;
}

const NEUTRAL_GENRE_DEFAULTS: GenreDefaults = {
  paletteHue: 30,
  saturationPct: 45,
  cutRatePerSec: 0.4,
  keyLightId: 'neutral-studio',
};

const GENRE_DEFAULTS: Record<string, GenreDefaults> = {
  'live-action': { paletteHue: 30, saturationPct: 50, cutRatePerSec: 0.4, keyLightId: 'golden-hour' },
  pixar: { paletteHue: 45, saturationPct: 80, cutRatePerSec: 0.5, keyLightId: 'neutral-studio' },
  anime: { paletteHue: 210, saturationPct: 75, cutRatePerSec: 0.7, keyLightId: 'hard-dawn' },
  noir: { paletteHue: 220, saturationPct: 10, cutRatePerSec: 0.3, keyLightId: 'night-fire' },
  influencer: { paletteHue: 25, saturationPct: 65, cutRatePerSec: 0.8, keyLightId: 'neutral-studio' },
  action: { paletteHue: 200, saturationPct: 70, cutRatePerSec: 1.2, keyLightId: 'hard-dawn' },
  'music-video': { paletteHue: 280, saturationPct: 85, cutRatePerSec: 1.0, keyLightId: 'night-fire' },
};

/**
 * Resolve per-genre look defaults. Case-insensitive; unknown genres fall
 * back to a neutral default rather than throwing.
 */
export function genreDefaults(genre: string): GenreDefaults {
  return GENRE_DEFAULTS[genre.toLowerCase()] ?? NEUTRAL_GENRE_DEFAULTS;
}

/**
 * Build an audio-mix prompt fragment at the requested detail level.
 *   - terse:    evocative words only, no numbers
 *   - standard: brief layer naming
 *   - rich:     an explicit dB hierarchy with a silence/re-entry beat
 */
export function audioMix(d: DetailLevel): string {
  if (d === 'terse') {
    return 'natural ambience, grounded foley, present dialogue';
  }
  if (d === 'standard') {
    return 'ambience bed under foley, dialogue forward, music supportive';
  }
  return (
    'ambient -4 dB, foley -1 dB, dialogue 0 dB ref, music -2 dB; ' +
    '1.5–2.5s silence then sudden re-entry'
  );
}
