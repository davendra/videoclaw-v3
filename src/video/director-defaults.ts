export type DirectorGenreId =
  | 'action-thriller'
  | 'storybook'
  | 'documentary'
  | 'ugc-ad'
  | 'music-video'
  | 'short-film'
  | 'romance'
  | 'horror'
  | 'sci-fi'
  | 'fantasy'
  | 'western'
  | 'custom';

export interface DirectorGenreDefaults {
  stylePresets: string[];
  gradingPresets: string[];
  defaultScenes: number;
  defaultDurationSeconds: number;
  tone: string;
  actStructure: string[];
  platforms: string[];
}

const LEGACY_RUNTIME_TO_SCENES: Record<string, number> = {
  '0:30': 2,
  '1:00': 4,
  '1:30': 6,
  '2:00': 8,
  '2:30': 10,
  '3:00': 12,
  '3:30': 14,
  '4:00': 16,
  '4:30': 18,
  '5:00': 20,
};

const DIRECTOR_GENRE_DEFAULTS: Record<DirectorGenreId, DirectorGenreDefaults> = {
  'action-thriller': {
    stylePresets: ['villeneuve', 'nolan', 'fincher'],
    gradingPresets: ['neon-noir', 'teal-orange', 'desaturated'],
    defaultScenes: 14,
    defaultDurationSeconds: 15,
    tone: 'dark, tense, fast-paced, rain-slicked, propulsive',
    actStructure: [
      'hook (stakes set)',
      'inciting incident',
      'escape begins',
      'chase / near-miss',
      'hideout / mentor arrives',
      'choice (protagonist agency)',
      'rising action',
      'clash (content-filter-safe verbs)',
      'cost / sacrifice',
      'resolution / dawn',
    ],
    platforms: ['youtube', 'tiktok'],
  },
  storybook: {
    stylePresets: ['miyazaki', 'wes-anderson'],
    gradingPresets: ['pastel-dream', 'golden-hour'],
    defaultScenes: 12,
    defaultDurationSeconds: 15,
    tone: 'warm, curious, gentle, childlike wonder, hand-painted',
    actStructure: [
      'opening image',
      'discovery',
      'curiosity',
      'challenge',
      'helper arrives',
      'lesson moment',
      'trial',
      'realization',
      'resolution with object',
      'reflection',
      'return home',
      'warm circular ending',
    ],
    platforms: ['youtube', 'reels'],
  },
  documentary: {
    stylePresets: ['nolan', 'villeneuve'],
    gradingPresets: ['desaturated', 'teal-orange'],
    defaultScenes: 10,
    defaultDurationSeconds: 15,
    tone: 'observational, grounded, respectful, natural light, authentic',
    actStructure: [
      'establishing location',
      'subject at work',
      'detail of tool or skill',
      'interaction',
      'quiet moment',
      'main task begins',
      'challenge',
      'adaptation',
      'resolution',
      'reflection / wide hero',
    ],
    platforms: ['youtube', 'linkedin'],
  },
  'ugc-ad': {
    stylePresets: ['spielberg', 'wes-anderson'],
    gradingPresets: ['golden-hour', 'pastel-dream'],
    defaultScenes: 10,
    defaultDurationSeconds: 12,
    tone: 'warm, aspirational, authentic, direct-to-camera friendly',
    actStructure: [
      'hook (problem)',
      'relatable struggle',
      'discovery moment',
      'first use',
      'surprise delight',
      'feature in action',
      'before/after',
      'testimonial',
      'social proof',
      'logo / CTA',
    ],
    platforms: ['tiktok', 'reels', 'shorts'],
  },
  'music-video': {
    stylePresets: ['wong-kar-wai', 'tarantino', 'fincher'],
    gradingPresets: ['neon-noir', 'vintage-film'],
    defaultScenes: 14,
    defaultDurationSeconds: 12,
    tone: 'rhythmic, mood-over-plot, visual motifs, no dialogue',
    actStructure: [
      'intro hook',
      'motif 1',
      'build',
      'motif 2',
      'pre-chorus tension',
      'chorus payoff',
      'verse 2 variation',
      'bridge',
      'second chorus',
      'breakdown',
      'final chorus',
      'outro fade',
    ],
    platforms: ['youtube', 'vimeo'],
  },
  'short-film': {
    stylePresets: ['villeneuve', 'nolan', 'fincher', 'ridley-scott'],
    gradingPresets: ['teal-orange', 'desaturated', 'neon-noir'],
    defaultScenes: 14,
    defaultDurationSeconds: 15,
    tone: 'cinematic, balanced, three-act arc, character-driven',
    actStructure: [
      'hook',
      'setup / world-establish',
      'inciting incident',
      'resistance',
      'commitment',
      'midpoint turn',
      'complication',
      'crisis',
      'climax',
      'resolution',
    ],
    platforms: ['youtube', 'vimeo'],
  },
  romance: {
    stylePresets: ['wes-anderson', 'spielberg'],
    gradingPresets: ['pastel-dream', 'golden-hour'],
    defaultScenes: 12,
    defaultDurationSeconds: 15,
    tone: 'soft, intimate, warm, bittersweet, light touch',
    actStructure: [
      'meet-cute',
      'attraction',
      'obstacle introduced',
      'first connection',
      'deepening',
      'misunderstanding',
      'separation',
      'revelation',
      'reconciliation',
      'resolution',
    ],
    platforms: ['youtube', 'reels'],
  },
  horror: {
    stylePresets: ['fincher', 'kubrick'],
    gradingPresets: ['ice-cold', 'desaturated', 'bleach-bypass'],
    defaultScenes: 12,
    defaultDurationSeconds: 15,
    tone: 'dread, unease, unsettling, silent-buildup, restrained',
    actStructure: [
      'normalcy',
      'first wrongness',
      'dismissal',
      'escalation',
      'witness',
      'flight',
      'confrontation',
      'reveal',
      'aftermath',
      'ambiguous ending',
    ],
    platforms: ['youtube', 'vimeo'],
  },
  'sci-fi': {
    stylePresets: ['villeneuve', 'ridley-scott', 'nolan'],
    gradingPresets: ['teal-orange', 'ice-cold', 'neon-noir'],
    defaultScenes: 14,
    defaultDurationSeconds: 15,
    tone: 'epic, awe, isolating, grand-scale, cerebral',
    actStructure: [
      'world-establish',
      'protagonist in context',
      'concept or tech introduced',
      'stakes raised',
      'exploration',
      'complication',
      'crisis / ethical moment',
      'choice',
      'consequence',
      'resolution (mixed hope)',
    ],
    platforms: ['youtube', 'vimeo'],
  },
  fantasy: {
    stylePresets: ['miyazaki', 'spielberg', 'ridley-scott'],
    gradingPresets: ['golden-hour', 'pastel-dream', 'teal-orange'],
    defaultScenes: 14,
    defaultDurationSeconds: 15,
    tone: 'wonder, quest, magic, epic landscape, heroic',
    actStructure: [
      'ordinary world',
      'call to adventure',
      'departure',
      'ally meets',
      'trial 1',
      'mentor lesson',
      'trial 2',
      'confrontation with magic',
      'victory with cost',
      'return transformed',
    ],
    platforms: ['youtube'],
  },
  western: {
    stylePresets: ['tarantino', 'ridley-scott'],
    gradingPresets: ['desaturated', 'vintage-film', 'golden-hour'],
    defaultScenes: 12,
    defaultDurationSeconds: 15,
    tone: 'laconic, wide landscape, taut silence, honor-code',
    actStructure: [
      'wide establishing',
      'stranger arrives',
      'tension',
      'backstory hint',
      'confrontation 1',
      'pause',
      'escalation',
      'showdown',
      'aftermath',
      'ride off',
    ],
    platforms: ['youtube', 'vimeo'],
  },
  custom: {
    stylePresets: [],
    gradingPresets: [],
    defaultScenes: 12,
    defaultDurationSeconds: 15,
    tone: '',
    actStructure: [],
    platforms: ['youtube'],
  },
};

const DIRECTOR_GENRE_INFERENCE_RULES: Array<{ genre: DirectorGenreId; patterns: RegExp[] }> = [
  { genre: 'ugc-ad', patterns: [/\bugc\b/i, /\btestimonial\b/i, /\bproduct\b/i, /\bcta\b/i, /\bad\b/i] },
  { genre: 'music-video', patterns: [/\bmusic video\b/i, /\bmv\b/i, /\bchorus\b/i, /\bverse\b/i, /\bsong\b/i] },
  { genre: 'documentary', patterns: [/\bdocumentary\b/i, /\bdocu\b/i, /\bportrait\b/i, /\bday in the life\b/i, /\bobservational\b/i] },
  { genre: 'horror', patterns: [/\bhorror\b/i, /\bmonster\b/i, /\bhaunt/i, /\bentity\b/i, /\bdread\b/i] },
  { genre: 'romance', patterns: [/\bromance\b/i, /\blove\b/i, /\bmeet-cute\b/i, /\bheartbreak\b/i] },
  { genre: 'western', patterns: [/\bwestern\b/i, /\bcowboy\b/i, /\bshowdown\b/i, /\boutlaw\b/i, /\bfrontier\b/i] },
  { genre: 'fantasy', patterns: [/\bfantasy\b/i, /\bmagic\b/i, /\bdragon\b/i, /\bquest\b/i, /\bwizard\b/i, /\bkingdom\b/i] },
  { genre: 'sci-fi', patterns: [/\bsci[- ]?fi\b/i, /\bastronaut\b/i, /\balien\b/i, /\bspace\b/i, /\bmars\b/i, /\bfuture\b/i, /\bandroid\b/i] },
  { genre: 'storybook', patterns: [/\bstorybook\b/i, /\bfairy tale\b/i, /\bchildlike\b/i, /\bwatercolor\b/i, /\bbedtime\b/i] },
  { genre: 'action-thriller', patterns: [/\baction\b/i, /\bthriller\b/i, /\bchase\b/i, /\bescape\b/i, /\bneo-tokyo\b/i, /\bspy\b/i] },
];

function normalizeGenreKey(input: string): string {
  return input.trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-');
}

function normalizePlatformValue(platform: string): string {
  const normalized = platform.trim().toLowerCase();
  switch (normalized) {
    case 'tiktok-vertical':
      return 'tiktok';
    case 'instagram-reels':
      return 'reels';
    case 'youtube-shorts':
      return 'shorts';
    default:
      return normalized;
  }
}

export function parseDirectorGenre(value: string | undefined): DirectorGenreId | undefined {
  if (!value) return undefined;
  const normalized = normalizeGenreKey(value);
  return Object.prototype.hasOwnProperty.call(DIRECTOR_GENRE_DEFAULTS, normalized)
    ? normalized as DirectorGenreId
    : undefined;
}

export function inferDirectorGenre(intent: string): DirectorGenreId {
  for (const rule of DIRECTOR_GENRE_INFERENCE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(intent))) {
      return rule.genre;
    }
  }
  return 'short-film';
}

export function getDirectorGenreDefaults(genre: DirectorGenreId): DirectorGenreDefaults {
  return DIRECTOR_GENRE_DEFAULTS[genre];
}

export function parseRuntimeSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
  }
  const match = /^(\d+):(\d{2})$/.exec(trimmed);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) {
    return undefined;
  }
  return minutes * 60 + seconds;
}

export function deriveSceneCountFromRuntime(runtimeSeconds: number, clipDurationSeconds: number): number {
  if (!Number.isFinite(runtimeSeconds) || runtimeSeconds <= 0) {
    throw new Error('Runtime seconds must be a positive number.');
  }
  if (!Number.isFinite(clipDurationSeconds) || clipDurationSeconds <= 0) {
    throw new Error('Clip duration seconds must be a positive number.');
  }
  return Math.max(1, Math.ceil(runtimeSeconds / clipDurationSeconds));
}

export function parseClipDurationSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || !Number.isInteger(seconds)) {
    return undefined;
  }
  if (seconds < 5 || seconds > 60) {
    throw new Error('Clip duration must be between 5 and 60 seconds.');
  }
  return seconds;
}

export function resolveDirectorCreateDefaults(input: {
  intent: string;
  explicitGenre?: string;
  explicitRuntime?: string;
  explicitClipDurationSeconds?: number;
  explicitSceneCount?: number;
  explicitPlatform?: string;
  explicitStyle?: string;
  explicitColorGrading?: string;
}): {
  genre: DirectorGenreId;
  sceneCount: number;
  platform?: string;
  style?: string;
  colorGrading?: string;
  durationSeconds: number;
  tone: string;
  actStructure: string[];
  runtimeSeconds?: number;
} {
  const genre = parseDirectorGenre(input.explicitGenre) ?? inferDirectorGenre(input.intent);
  const defaults = getDirectorGenreDefaults(genre);
  const clipDurationSeconds = input.explicitClipDurationSeconds ?? defaults.defaultDurationSeconds;
  const runtimeSeconds = parseRuntimeSeconds(input.explicitRuntime);
  const sceneCount = input.explicitSceneCount
    ?? (runtimeSeconds !== undefined
      ? deriveSceneCountFromRuntime(runtimeSeconds, clipDurationSeconds)
      : defaults.defaultScenes);
  return {
    genre,
    sceneCount,
    platform: input.explicitPlatform ? normalizePlatformValue(input.explicitPlatform) : normalizePlatformValue(defaults.platforms[0] ?? 'youtube'),
    style: input.explicitStyle ?? defaults.stylePresets[0],
    colorGrading: input.explicitColorGrading ?? defaults.gradingPresets[0],
    durationSeconds: clipDurationSeconds,
    tone: defaults.tone,
    actStructure: defaults.actStructure,
    ...(runtimeSeconds !== undefined ? { runtimeSeconds } : {}),
  };
}
