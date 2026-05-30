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
  lift?: number;
  gamma?: number;
  gain?: number;
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
  moonlight: { kelvin: 7000, keyDeg: 35, ratio: '6:1' },
  overcast: { kelvin: 6500, keyDeg: 60, ratio: '1.5:1' },
  'neon-split': { kelvin: 4500, keyDeg: 40, ratio: '3:1' },
  chiaroscuro: { kelvin: 3400, keyDeg: 20, ratio: '12:1' },
  silhouette: { kelvin: 5000, keyDeg: 10, ratio: '16:1' },
  fluorescent: { kelvin: 4300, keyDeg: 70, ratio: '1.2:1' },
  'night-practical': { kelvin: 2800, keyDeg: 25, ratio: '7:1' },
  'night-urban-neon': { kelvin: 5200, keyDeg: 30, ratio: '5:1' },
  'rembrandt-gray': { kelvin: 5200, keyDeg: 40, ratio: '3:1' },
};

const LIGHTING_WORDS: Record<string, string> = {
  'hard-dawn': 'crisp directional dawn light, long raking shadows',
  'golden-hour': 'warm low golden-hour glow, soft long shadows',
  'neutral-studio': 'clean balanced studio light, even and neutral',
  'night-fire': 'flickering warm firelight against deep night shadow',
  moonlight: 'cool blue moonlight, soft and directional with deep shadows',
  overcast: 'flat soft overcast daylight, low contrast and even',
  'neon-split': 'split warm/cool neon key, magenta-and-cyan separation',
  chiaroscuro: 'extreme chiaroscuro, a single hard source carving light from darkness',
  silhouette: 'strong backlight rendering the subject as a near-silhouette',
  fluorescent: 'flat green-tinged overhead fluorescent, institutional and even',
  'night-practical': 'warm practical pools against deep night, motivated sources only',
  'night-urban-neon': 'wet-street urban neon, mixed signage color spill at night',
  'rembrandt-gray': 'lean single-source Rembrandt close on a gray plate, matte and warm',
};

const GRADE: Record<string, GradePreset> = {
  'desaturated-earth': { shadowHue: 30, shadowSat: 18, highlightHue: 45, highlightSat: 22 },
  'teal-orange': { shadowHue: 190, shadowSat: 45, highlightHue: 30, highlightSat: 55 },
  'noir-bw': { shadowHue: 0, shadowSat: 0, highlightHue: 0, highlightSat: 0 },
  'warm-nostalgia': { shadowHue: 35, shadowSat: 25, highlightHue: 40, highlightSat: 30, gamma: 1.05 },
  'cool-isolation': { shadowHue: 210, shadowSat: 30, highlightHue: 205, highlightSat: 20 },
  'cyberpunk-neon': { shadowHue: 280, shadowSat: 60, highlightHue: 320, highlightSat: 65 },
  'bleach-bypass': { shadowHue: 0, shadowSat: 6, highlightHue: 0, highlightSat: 4, lift: 0.12, gamma: 1.1, gain: 0.92 },
  'mono-accent': { shadowHue: 0, shadowSat: 0, highlightHue: 0, highlightSat: 8 },
};

const GRADE_WORDS: Record<string, string> = {
  'desaturated-earth': 'muted earthy palette, dusty and restrained',
  'teal-orange': 'cinematic teal-and-orange contrast',
  'noir-bw': 'high-contrast monochrome noir',
  'warm-nostalgia': 'warm faded nostalgia, soft amber memory tone',
  'cool-isolation': 'cool desaturated isolation, blue-grey distance',
  'cyberpunk-neon': 'saturated magenta-and-cyan cyberpunk neon',
  'bleach-bypass': 'low-saturation high-density bleach-bypass with lifted blacks',
  'mono-accent': 'near-monochrome with a single restrained accent hue',
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
  if (id === 'rembrandt-gray') {
    const lean =
      'one broad diffused source from camera-left and slightly above, a soft triangle of light on the shadow cheek, ' +
      'no hard shadow edges, no rim light, no hair light, no kicker; skin matte and velvety, warmth preserved and natural, never pale or cool-shifted';
    return d === 'standard' ? '5200K key at 40°, 3:1 ratio' : `5200K key at 40°, 3:1 ratio, ${lean}`;
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
  const richBase =
    `shadows ${preset.shadowHue}° ${preset.shadowSat}% tint; ` +
    `highlights ${preset.highlightHue}° ${preset.highlightSat}% tint, ${words}`;
  const curve = [
    preset.lift !== undefined ? `lift ${preset.lift}` : '',
    preset.gamma !== undefined ? `gamma ${preset.gamma}` : '',
    preset.gain !== undefined ? `gain ${preset.gain}` : '',
  ].filter(Boolean).join(', ');
  return curve ? `${richBase}; ${curve}` : richBase;
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
  'speed-ramp',
  'first-person-rush',
  'impact-freeze',
  'title-burn-in',
  'slow-reveal',
  'snap-zoom',
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
  'speed-ramp':
    'Action ramps from slow-motion into real time on a single continuous move, time compressing as the hero subject commits.',
  'first-person-rush':
    'A first-person rush hurtles forward through the environment, motion close and visceral, before braking hard on the hero subject.',
  'impact-freeze':
    'The frame slams to a freeze on the exact instant of impact, debris suspended mid-air, then releases back into motion.',
  'title-burn-in':
    'A single word burns in from particulate or light, holds for a beat, then dissolves as the scene takes over.',
  'slow-reveal':
    'A slow tilt or pull gradually uncovers the hero subject from an obscuring foreground element, withholding then granting the full view.',
  'snap-zoom':
    'A fast snap-zoom punches from a wide to a tight frame on the hero subject, landing hard with no settle.',
};

/**
 * Pad an integer second count to a 2-digit string (assumes < 60).
 */
function padSeconds(seconds: number): string {
  return String(seconds).padStart(2, '0');
}

/**
 * Resolve a named opening-hook pattern id to its directive description.
 *
 * Like {@link hookBeat}, an unknown id THROWS rather than falling back — hooks
 * must be explicit. Exported so CLI surfaces can prepend the directive without
 * re-deriving the table.
 */
export function resolveHookPattern(pattern: HookPatternId): string {
  const description = HOOK_PATTERNS[pattern];
  if (!description) {
    throw new Error(`unknown hook pattern: ${pattern}`);
  }
  return description;
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
 * A single ordered beat in a structured shot timeline. Beats are contiguous:
 * the first `start` is 0 and the last `end` is the clip duration, with no gaps.
 */
export interface Beat {
  start: number;
  end: number;
  label: string;
  direction: string;
}

/**
 * The beat-structure templates a shot plan can be scaffolded from. Mirrors the
 * `BeatTemplate` union in {@link ../category-registry}.
 */
export type BeatTemplateId = 'three-act' | 'ad-hook-feature-cta' | 'turntable' | 'lookbook';

interface BeatStep {
  label: string;
  direction: string;
  weight: number;
}

/**
 * Lay out a sequence of weighted steps as contiguous beats spanning
 * `[startOffset, durationSeconds]`. The last beat's `end` is pinned exactly to
 * `durationSeconds` so rounding never leaves a gap or overshoot.
 */
function layoutSteps(steps: BeatStep[], durationSeconds: number, startOffset: number): Beat[] {
  const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0) || 1;
  const span = durationSeconds - startOffset;
  const result: Beat[] = [];
  let cursor = startOffset;
  steps.forEach((step, index) => {
    const isLast = index === steps.length - 1;
    const end = isLast
      ? durationSeconds
      : Math.round((cursor + (span * step.weight) / totalWeight) * 100) / 100;
    result.push({ start: cursor, end, label: step.label, direction: step.direction });
    cursor = end;
  });
  return result;
}

/**
 * Generate an ordered, contiguous set of {@link Beat}s for a beat template.
 *
 * The first beat always starts at 0 and the last beat always ends at
 * `durationSeconds`, with no gaps between adjacent beats.
 *
 * - `three-act`: setup → inciting → rising → climax → resolve.
 * - `ad-hook-feature-cta`: a HOOK beat `[0, hookSeconds]` (defaulting to a short
 *   2s hook, clamped below the duration, when `hookSeconds` is 0), then
 *   feature/benefit beats, ending with a CTA beat.
 * - `turntable`: a "Hero angle" open and a "Hero angle (return)" close bracketing
 *   rotation beats.
 * - `lookbook`: a sequence of pose-change beats.
 */
export function beats(
  template: BeatTemplateId,
  durationSeconds: number,
  hookSeconds: number,
): Beat[] {
  switch (template) {
    case 'three-act':
      return layoutSteps(
        [
          { label: 'Setup', direction: 'establish the subject, place, and tone', weight: 1 },
          { label: 'Inciting', direction: 'introduce the disruption that sets the story in motion', weight: 1 },
          { label: 'Rising', direction: 'escalate stakes and momentum toward the peak', weight: 2 },
          { label: 'Climax', direction: 'land the highest-energy payoff beat', weight: 1 },
          { label: 'Resolve', direction: 'settle the frame and leave a lingering final image', weight: 1 },
        ],
        durationSeconds,
        0,
      );
    case 'ad-hook-feature-cta': {
      const hookEnd =
        hookSeconds > 0
          ? Math.min(hookSeconds, durationSeconds)
          : Math.min(2, Math.max(0, durationSeconds - 1));
      const hook: Beat = {
        start: 0,
        end: hookEnd,
        label: 'Hook',
        direction: 'scroll-stopping opening beat that earns the next second',
      };
      const rest = layoutSteps(
        [
          { label: 'Feature', direction: 'show the product or idea in clear, confident detail', weight: 1 },
          { label: 'Benefit', direction: 'translate the feature into a felt payoff for the viewer', weight: 1 },
          { label: 'CTA', direction: 'direct call to action with a clear next step', weight: 1 },
        ],
        durationSeconds,
        hookEnd,
      );
      return [hook, ...rest];
    }
    case 'turntable':
      return layoutSteps(
        [
          { label: 'Hero angle', direction: 'open on the hero three-quarter angle, locked and clean', weight: 1 },
          { label: 'Rotation', direction: 'smooth quarter-turn revealing form and surface', weight: 1 },
          { label: 'Rotation (back)', direction: 'continue the orbit through the rear profile', weight: 1 },
          { label: 'Hero angle (return)', direction: 'settle back on the hero three-quarter angle to close', weight: 1 },
        ],
        durationSeconds,
        0,
      );
    case 'lookbook':
      return layoutSteps(
        [
          { label: 'Look 1', direction: 'first pose and styling, full-length establishing frame', weight: 1 },
          { label: 'Look 2', direction: 'pose change with a fresh angle and energy', weight: 1 },
          { label: 'Look 3', direction: 'final pose and styling, signature closing frame', weight: 1 },
        ],
        durationSeconds,
        0,
      );
    default: {
      const exhaustive: never = template;
      throw new Error(`unknown beat template: ${String(exhaustive)}`);
    }
  }
}

/**
 * Precise orbit/turntable camera grammar. Product-360 categories need exact
 * terms — a generic "orbit" conflates three distinct motions:
 *   - `product-rotation`: the object spins; the camera stays locked/static.
 *   - `camera-orbit`: the camera circles a static subject.
 *   - `parallax-orbit`: the camera arcs with foreground/background depth parallax.
 *
 * Order is intentional and stable; tests assert the sorted set.
 */
export const ORBIT_KINDS = ['product-rotation', 'camera-orbit', 'parallax-orbit'] as const;

export type OrbitKind = (typeof ORBIT_KINDS)[number];

const ORBIT_GRAMMAR: Record<OrbitKind, string> = {
  'product-rotation':
    'Camera locked off and static; the object rotates in place on a motorized turntable, spinning a smooth 360° to reveal every surface while the frame stays perfectly still.',
  'camera-orbit':
    'Camera arcs in a smooth circle around a static subject, orbiting on a fixed radius so the subject holds dead-center while the background sweeps behind it.',
  'parallax-orbit':
    'Camera arcs around the subject with pronounced depth parallax — foreground elements sweep past faster than the distant background, layering the planes for a strong sense of dimensional depth.',
};

/**
 * Resolve a precise camera-direction string for an {@link OrbitKind}. Unknown
 * kinds fall back to the `camera-orbit` grammar rather than throwing.
 */
export function orbitGrammar(kind: OrbitKind): string {
  return ORBIT_GRAMMAR[kind] ?? ORBIT_GRAMMAR['camera-orbit'];
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

/**
 * Anti-plastic physics clauses (banana-pro-director). Each is a standalone
 * exported string helper so callers can compose them individually before the
 * full captureRealismBlock lands. Per-zone specular naming is required —
 * "matte skin" alone is too weak and gets overridden by the model default.
 */
export function specularKillClause(): string {
  return 'all specular highlights surgically removed from skin — zero shine on forehead, nose bridge, cheekbones, temples, and chin, no oily T-zone, skin matte and velvety';
}

export function subsurfaceScatteringClause(): string {
  return 'subsurface scattering at ear edges, nostrils, and around the eye sockets with warm undertone bleed, reading as semi-translucent biology never opaque plastic';
}

export function strandHairClause(): string {
  return 'hair rendered strand by strand with flyaways and baby hairs at the hairline, hair physics responding to the actual environment, matte by default never glossy';
}

export function contrastCurveClause(): string {
  return 'shadows lifted gently, highlights rolled off, nothing clipping or crushing — a low-contrast slightly-desaturated grade with warmth preserved';
}

export function moistureMatteClause(): string {
  return 'damp not beaded, wet not glossy — moisture mutes and saturates the surface without a single specular hotspot';
}

export function flatteringRealismClause(): string {
  return 'no acne, no blemishes, no enlarged or rough pores, no harsh clinical texture — fine flattering even skin';
}

export type HazeDensity = 'thin' | 'light' | 'heavy';

const HAZE_WORDS: Record<HazeDensity, string> = {
  thin: 'a faint trace of atmosphere',
  light: 'light atmospheric haze',
  heavy: 'heavy volumetric haze and visible air density',
};

/**
 * Volumetric depth ("lighting the air") — the single biggest anti-plastic
 * depth lever. Exposed standalone; previously reachable only inside the
 * `atmospheric` cinema mode's filtration field.
 */
export function volumetricHaze(density: HazeDensity, d: DetailLevel): string {
  const words = HAZE_WORDS[density];
  if (d === 'terse') {
    return `${words} between camera, subject, and background`;
  }
  const core =
    `${words} between the camera, subject, and background — distant planes rendered softer, ` +
    'desaturated, and lower-contrast than the foreground';
  if (d === 'standard') {
    return core;
  }
  return `${core}; real volumetric atmosphere, never a flat backdrop`;
}

export interface CaptureRealismOpts {
  /** Emit the moisture-matte clause (skipped when false/omitted). */
  wet?: boolean;
  /** Haze density for the depth clause (default 'light'). */
  haze?: HazeDensity;
  /** Film-grain stock descriptor (default '35mm'). */
  grainStock?: string;
}

/**
 * The keystone anti-AI-look block: physics-vs-hardware separation that does not
 * exist anywhere else in the codebase. Composes per-zone specular kill,
 * subsurface scattering, strand hair, contrast-curve-three-ways, volumetric
 * haze, optional moisture, the flattering-realism ceiling, and film grain.
 * Pure and deterministic; density scales with DetailLevel.
 */
export function captureRealismBlock(opts: CaptureRealismOpts, d: DetailLevel): string {
  const grain = opts.grainStock ?? '35mm';
  const haze = volumetricHaze(opts.haze ?? 'light', d);
  // terse: condensed summary (full clause composition only on standard/rich)
  if (d === 'terse') {
    return `Matte anti-plastic skin, soft ${grain} grain, ${haze}.`;
  }
  const parts = [
    specularKillClause(),
    subsurfaceScatteringClause(),
    strandHairClause(),
    contrastCurveClause(),
    haze,
    flatteringRealismClause(),
  ];
  if (opts.wet) {
    parts.push(moistureMatteClause());
  }
  parts.push(`soft natural ${grain} film grain, photographed not generated`);
  return `Capture realism: ${parts.join('; ')}.`;
}

export type PlateKind = 'mid-gray' | 'white' | 'black';

const PLATE_WORDS: Record<PlateKind, string> = {
  'mid-gray':
    'even neutral mid-gray seamless background, no seam line, no gradient, no falloff to black or white',
  white: 'clean white seamless background, evenly lit, no gradient',
  black: 'deep matte black seamless background, no spill, no falloff edge',
};

/**
 * Backdrop plate spec. Mid-gray is the locked default for ALL character work —
 * it lowers subject-to-background contrast so downstream video inherits cleaner
 * edges. White/black are explicit opt-ins.
 */
export function backgroundPlate(kind: PlateKind, d: DetailLevel): string {
  const words = PLATE_WORDS[kind];
  if (d === 'terse') {
    return words;
  }
  if (kind === 'mid-gray') {
    // standard: plate words only; rich: add the true-natural-tone elaboration
    return d === 'rich'
      ? `${words}; subject and wardrobe rendered at their true natural tone against the neutral gray`
      : words;
  }
  return words;
}

/**
 * Beat-aligned audio direction for music videos. Positive tempo phrasing only
 * (negative direction like "no slow motion" does not work on these models).
 */
export function musicSyncLine(bpm: number | undefined, d: DetailLevel): string {
  if (d === 'terse') {
    return 'cuts and motion land on the beat';
  }
  const tempo = bpm ? ` at ${bpm} BPM` : '';
  const core = `cuts, accents, and subject motion land on the downbeat${tempo}, edited to the music's rhythm`;
  if (d === 'standard') {
    return core;
  }
  return `${core}; energy builds into each drop and holds through the bar`;
}
