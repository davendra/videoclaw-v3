export type PromptQualitySeverity = 'warn' | 'error';

export type PromptQualityIssueCode =
  | 'prompt-quality-adjective-soup'
  | 'prompt-quality-multiple-actions'
  | 'prompt-quality-multiple-camera-moves'
  | 'prompt-quality-style-word-overload'
  | 'prompt-quality-literary-emotion'
  | 'prompt-quality-overlong'
  | 'multi-shot-timecode-parse'
  | 'multi-shot-timecode-start'
  | 'multi-shot-timecode-gap'
  | 'multi-shot-timecode-total'
  | 'multi-shot-shot-duration'
  | 'multi-shot-shot-count-out-of-range'
  | 'multi-shot-overlong'
  | 'multi-shot-repeated-parameter'
  | 'multi-shot-missing-metadata';

export interface PromptQualityIssue {
  code: PromptQualityIssueCode;
  severity: PromptQualitySeverity;
  message: string;
}

export const ADJECTIVE_SOUP_THRESHOLD = 4;
export const STYLE_WORDS_THRESHOLD = 3;
export const OVERLONG_WORDS_THRESHOLD = 120;

export const CAMERA_MOVE_VOCABULARY = [
  'push-in',
  'pull-out',
  'tracking',
  'orbit',
  'static',
  'locked-off',
  'crane reveal',
  'crane',
  'dolly',
  'pan',
  'tilt',
  'zoom',
  'handheld',
  'steadicam',
] as const;

export const SHOT_TYPE_VOCABULARY = [
  'establishing shot',
  'close-up',
  'wide shot',
  'medium shot',
] as const;

// Canonical multi-shot camera-grid parameter vocabularies. These live here
// (alongside CAMERA_MOVE_VOCABULARY) so both multi-shot-prompt.ts (which builds
// plans) and runMultiShotChecks (which validates them) share one source of
// truth and cannot silently diverge. multi-shot-prompt.ts imports these.
export const SHOT_SIZE_VOCABULARY = [
  'wide',
  'medium',
  'medium close-up',
  'close-up',
  'macro',
] as const;

export const LENS_VOCABULARY = ['24mm', '35mm', '50mm', '85mm'] as const;

export const ANGLE_VOCABULARY = [
  'low angle',
  'high angle',
  'eye-level',
  'over-the-shoulder',
  'Dutch angle',
] as const;

export const STYLE_VOCABULARY = [
  'cinematic',
  'epic',
  'atmospheric',
  'ethereal',
  'hyperrealistic',
  'photorealistic',
  'surreal',
  'dramatic',
  'moody',
  'vibrant',
  'nostalgic',
  'gritty',
  'dreamy',
  'stylized',
] as const;

export const EMOTION_LANGUAGE_PATTERNS: RegExp[] = [
  /\b(feels|seems|appears|evokes|conveys)\s+\w+/gi,
  /\b(profound|deep|overwhelming|ethereal)\s+(sadness|joy|longing|feeling)\b/gi,
];

function currentSeverity(): PromptQualitySeverity {
  return process.env.DIRECTOR_STRICT_PROMPT_QUALITY === '1' ? 'error' : 'warn';
}

const ADJECTIVE_SUFFIX_PATTERN = /(?:y|ed|ing|ous|ful|less|ish|ive|ant|ent|ic|al)$/i;

const ADJECTIVE_WHITELIST = new Set([
  'tall', 'short', 'big', 'small', 'old', 'young', 'new', 'hot', 'cold',
  'warm', 'cool', 'fast', 'slow', 'soft', 'hard', 'dark', 'light', 'pale',
  'bright', 'dim', 'quiet', 'loud', 'stoic', 'calm', 'tense', 'sharp',
]);

function countAdjectives(clause: string): number {
  // Comma-separated modifier tokens in one clause.
  const parts = clause.split(',').map((piece) => piece.trim()).filter(Boolean);
  if (parts.length < 2) {
    return 0;
  }
  // All comma-separated pieces except the final one are modifier positions.
  // The last piece typically contains the noun and verb.
  const modifiers = parts.slice(0, -1);
  let count = 0;
  for (const raw of modifiers) {
    // Use the last word of the modifier segment as the candidate adjective.
    const tokens = raw.split(/\s+/);
    const candidate = (tokens[tokens.length - 1] ?? '').toLowerCase().replace(/[^a-z-]/g, '');
    if (!candidate) continue;
    if (ADJECTIVE_WHITELIST.has(candidate) || ADJECTIVE_SUFFIX_PATTERN.test(candidate) || candidate.includes('-')) {
      count += 1;
    }
  }
  return count;
}

function checkOverlongPrompt(
  prompt: string,
  severity: PromptQualitySeverity,
): PromptQualityIssue | null {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  if (words.length > OVERLONG_WORDS_THRESHOLD) {
    return {
      code: 'prompt-quality-overlong',
      severity,
      message: `prompt is ${words.length} words (threshold: ${OVERLONG_WORDS_THRESHOLD}); tighten to one shot`,
    };
  }
  return null;
}

function checkLiteraryEmotion(
  prompt: string,
  severity: PromptQualitySeverity,
): PromptQualityIssue | null {
  for (const raw of EMOTION_LANGUAGE_PATTERNS) {
    const pattern = new RegExp(raw.source, raw.flags);
    const match = pattern.exec(prompt);
    if (match) {
      return {
        code: 'prompt-quality-literary-emotion',
        severity,
        message: `prompt uses literary/inner-state language ("${match[0]}"); describe visible behavior instead`,
      };
    }
  }
  return null;
}

function checkStyleWordOverload(
  prompt: string,
  severity: PromptQualitySeverity,
): PromptQualityIssue | null {
  const matches: string[] = [];
  for (const term of STYLE_VOCABULARY) {
    const pattern = new RegExp(`\\b${term}\\b`, 'gi');
    const found = prompt.match(pattern);
    if (found && found.length > 0) {
      matches.push(term);
    }
  }
  if (matches.length > STYLE_WORDS_THRESHOLD) {
    return {
      code: 'prompt-quality-style-word-overload',
      severity,
      message: `prompt stacks ${matches.length} style words (threshold: ${STYLE_WORDS_THRESHOLD}): ${matches.join(', ')}`,
    };
  }
  return null;
}

interface CameraMovePattern {
  canonical: string;
  label: string;
  pattern: RegExp;
}

const CAMERA_MOVE_PATTERNS: CameraMovePattern[] = [
  {
    canonical: 'push-in',
    label: 'push-in',
    pattern: /\b(?:push(?:es|ed|ing)?[-\s]?in|doll(?:y|ies|ied|ying)\s+in)\b/gi,
  },
  {
    canonical: 'pull-out',
    label: 'pull-out',
    pattern: /\b(?:pull(?:s|ed|ing)?[-\s]?out|doll(?:y|ies|ied|ying)\s+out)\b/gi,
  },
  {
    canonical: 'tracking',
    label: 'tracking',
    pattern: /\btrack(?:s|ed|ing)?\b/gi,
  },
  {
    canonical: 'orbit',
    label: 'orbit',
    pattern: /\borbit(?:s|ed|ing)?\b/gi,
  },
  {
    canonical: 'static',
    label: 'static/locked-off',
    pattern: /\b(?:static(?:\s+camera)?|locked[-\s]?off)\b/gi,
  },
  {
    canonical: 'crane reveal',
    label: 'crane reveal',
    pattern: /\bcrane(?:s|d|ing)?(?:\s+reveal)?\b/gi,
  },
  {
    canonical: 'dolly',
    label: 'dolly',
    pattern: /\bdoll(?:y|ies|ied|ying)\b(?!\s+(?:in|out)\b)/gi,
  },
  {
    canonical: 'pan',
    label: 'pan',
    pattern: /\bpan(?:s|ned|ning)?\b/gi,
  },
  {
    canonical: 'tilt',
    label: 'tilt',
    pattern: /\btilt(?:s|ed|ing)?\b/gi,
  },
  {
    canonical: 'zoom',
    label: 'zoom',
    pattern: /\bzoom(?:s|ed|ing)?\b/gi,
  },
  {
    canonical: 'handheld',
    label: 'handheld',
    pattern: /\bhandheld\b/gi,
  },
  {
    canonical: 'steadicam',
    label: 'steadicam',
    pattern: /\bsteadicam\b/gi,
  },
];

function checkMultipleCameraMoves(
  prompt: string,
  severity: PromptQualitySeverity,
): PromptQualityIssue | null {
  const matches = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const move of CAMERA_MOVE_PATTERNS) {
    const pattern = new RegExp(move.pattern.source, move.pattern.flags);
    const found = prompt.match(pattern);
    if (found && found.length > 0) {
      matches.set(move.canonical, move.label);
      counts.set(move.canonical, (counts.get(move.canonical) ?? 0) + found.length);
    }
  }
  const repeatsSameMove = [...counts].some(([canonical, count]) => canonical !== 'static' && count > 1);
  if (matches.size > 1 || repeatsSameMove) {
    return {
      code: 'prompt-quality-multiple-camera-moves',
      severity,
      message: `prompt references multiple camera moves (${[...matches.values()].join(', ')}); pick one per shot`,
    };
  }
  return null;
}

const COMMON_ACTION_VERBS = new Set([
  'walks', 'runs', 'sits', 'stands', 'opens', 'closes', 'picks', 'places',
  'turns', 'orders', 'checks', 'lifts', 'sets', 'grabs', 'pushes', 'pulls',
  'enters', 'leaves', 'drops', 'catches', 'throws', 'holds', 'reaches',
]);

function checkMultipleActions(
  prompt: string,
  severity: PromptQualitySeverity,
): PromptQualityIssue | null {
  const clauses = prompt.split(/[.;]/);
  for (const clause of clauses) {
    const tokens = clause.toLowerCase().match(/\b[a-z]+\b/g) ?? [];
    let actionCount = 0;
    for (const token of tokens) {
      if (COMMON_ACTION_VERBS.has(token)) {
        actionCount += 1;
      } else if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
        // Heuristic: present-tense third-person verb ending in -s.
        // Require a trailing comma or conjunction context to avoid plural nouns.
        // We use a regex check below instead.
      }
    }
    // Additional heuristic: count action-style "<verb>s" tokens that sit
    // immediately before a comma — a reliable signal of serial actions.
    const commaPrecededVerbs = clause.match(/\b[a-z]+s(?=\s*,)/gi) ?? [];
    for (const raw of commaPrecededVerbs) {
      const token = raw.toLowerCase();
      if (COMMON_ACTION_VERBS.has(token)) continue; // already counted
      if (token.length > 3 && !token.endsWith('ss') && !token.endsWith('is') && !token.endsWith('us')) {
        actionCount += 1;
      }
    }
    if (actionCount > 1) {
      return {
        code: 'prompt-quality-multiple-actions',
        severity,
        message: `clause has ${actionCount} dominant actions (threshold: 1): "${clause.trim()}"`,
      };
    }
  }
  return null;
}

function checkAdjectiveSoup(
  prompt: string,
  severity: PromptQualitySeverity,
): PromptQualityIssue | null {
  const clauses = prompt.split(/[.;]/);
  for (const clause of clauses) {
    const adjectives = countAdjectives(clause);
    if (adjectives > ADJECTIVE_SOUP_THRESHOLD) {
      return {
        code: 'prompt-quality-adjective-soup',
        severity,
        message: `clause has ${adjectives} adjectives (threshold: ${ADJECTIVE_SOUP_THRESHOLD}): "${clause.trim()}"`,
      };
    }
  }
  return null;
}

export function runPromptQualityChecks(prompt: string): PromptQualityIssue[] {
  const severity = currentSeverity();
  const issues: PromptQualityIssue[] = [];
  const adjectiveSoup = checkAdjectiveSoup(prompt, severity);
  if (adjectiveSoup) issues.push(adjectiveSoup);
  const multipleActions = checkMultipleActions(prompt, severity);
  if (multipleActions) issues.push(multipleActions);
  const multipleMoves = checkMultipleCameraMoves(prompt, severity);
  if (multipleMoves) issues.push(multipleMoves);
  const styleOverload = checkStyleWordOverload(prompt, severity);
  if (styleOverload) issues.push(styleOverload);
  const literary = checkLiteraryEmotion(prompt, severity);
  if (literary) issues.push(literary);
  const overlong = checkOverlongPrompt(prompt, severity);
  if (overlong) issues.push(overlong);
  return issues;
}

// ---------------------------------------------------------------------------
// Multi-shot validator
// ---------------------------------------------------------------------------
// NOTE: `multi-shot-prompt.ts` imports CAMERA_MOVE_VOCABULARY FROM this file.
// We import only the TYPE `MultiShotPreset` here so the import is erased at
// compile time — no runtime cycle.
import type { MultiShotPreset } from './multi-shot-prompt.js';

// Derived from the canonical vocab constants above so the validator's match
// lists can't drift from what multi-shot-prompt.ts uses to build plans.
const MULTI_SHOT_SHOT_SIZES = SHOT_SIZE_VOCABULARY.map((s) => s.toLowerCase());
const MULTI_SHOT_LENSES = LENS_VOCABULARY.map((s) => s.toLowerCase());
const MULTI_SHOT_ANGLES = ANGLE_VOCABULARY.map((s) => s.toLowerCase());

const TIMECODE_RE = /\[(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})\]/g;

function toSeconds(mm: string, ss: string): number {
  return Number(mm) * 60 + Number(ss);
}

function firstMatch(haystack: string, pool: string[]): string | undefined {
  // Normalise both sides: lowercase + replace hyphens with spaces so that
  // hand-authored "push in" matches vocab term "push-in", "close up" matches
  // "close-up", "eye level" matches "eye-level", etc.  The canonical term
  // returned is the original (pre-normalisation) pool entry so downstream
  // equality comparisons (consecutive-repeat detection) remain stable.
  const normHaystack = haystack.toLowerCase().replace(/-/g, ' ');
  // Longest-first so "medium close-up" wins over "medium".
  for (const term of [...pool].sort((a, b) => b.length - a.length)) {
    const normTerm = term.toLowerCase().replace(/-/g, ' ');
    if (normHaystack.includes(normTerm)) return term;
  }
  return undefined;
}

export function runMultiShotChecks(
  prompt: string,
  preset: MultiShotPreset,
): PromptQualityIssue[] {
  // Multi-shot issues are structural (timecode contiguity, durations, metadata),
  // so they are always errors — unlike the stylistic runPromptQualityChecks,
  // which downgrades to warnings unless DIRECTOR_STRICT_PROMPT_QUALITY=1.
  const severity: PromptQualitySeverity = 'error';
  const issues: PromptQualityIssue[] = [];

  // Character budget.
  if (prompt.length > preset.maxChars) {
    issues.push({
      code: 'multi-shot-overlong',
      severity,
      message: `prompt is ${prompt.length} chars (max ${preset.maxChars})`,
    });
  }

  // Metadata block.
  const hasLocation = /^Location:\s*\S/m.test(prompt);
  const hasStyle = /^Style:\s*\S/m.test(prompt);
  const hasAudio = /^Audio:\s*\S/m.test(prompt);
  if (!hasLocation || !hasStyle || !hasAudio) {
    issues.push({
      code: 'multi-shot-missing-metadata',
      severity,
      message: `missing metadata line(s): ${[!hasLocation && 'Location', !hasStyle && 'Style', !hasAudio && 'Audio'].filter(Boolean).join(', ')}`,
    });
  }

  // Parse timecodes and per-shot lines.
  const shots: Array<{ start: number; end: number; line: string }> = [];
  const lines = prompt.split('\n').filter((l) => l.trim().length > 0);
  for (const line of lines) {
    TIMECODE_RE.lastIndex = 0;
    const m = TIMECODE_RE.exec(line);
    if (m) {
      shots.push({ start: toSeconds(m[1], m[2]), end: toSeconds(m[3], m[4]), line });
    }
  }

  if (shots.length === 0) {
    issues.push({
      code: 'multi-shot-timecode-parse',
      severity,
      message: 'no parseable timecode stamps found',
    });
    return issues;
  }

  if (shots[0].start !== 0) {
    issues.push({
      code: 'multi-shot-timecode-start',
      severity,
      message: `first shot starts at ${shots[0].start}s (must start at 0)`,
    });
  }

  for (let i = 0; i < shots.length; i += 1) {
    const dur = shots[i].end - shots[i].start;
    if (dur < preset.minShotSeconds || dur > preset.maxShotSeconds) {
      issues.push({
        code: 'multi-shot-shot-duration',
        severity,
        message: `shot ${i + 1} is ${dur}s (allowed ${preset.minShotSeconds}-${preset.maxShotSeconds}s)`,
      });
    }
    if (i > 0 && shots[i].start !== shots[i - 1].end) {
      issues.push({
        code: 'multi-shot-timecode-gap',
        severity,
        message: shots[i].start < shots[i - 1].end
          ? `shot ${i + 1} overlaps: starts at ${shots[i].start}s but previous ends at ${shots[i - 1].end}s`
          : `shot ${i + 1} has a gap: starts at ${shots[i].start}s but previous ends at ${shots[i - 1].end}s`,
      });
    }
  }

  const total = shots[shots.length - 1].end - shots[0].start;
  if (total !== preset.totalSeconds) {
    issues.push({
      code: 'multi-shot-timecode-total',
      severity,
      message: `sequence totals ${total}s (must be exactly ${preset.totalSeconds}s)`,
    });
  }

  // Shot-count window check. Branched message so operators see direction.
  if (shots.length < preset.minShots) {
    issues.push({
      code: 'multi-shot-shot-count-out-of-range',
      severity,
      message: `too few shots: ${shots.length} < preset.minShots=${preset.minShots} (preset "${preset.name}")`,
    });
  } else if (shots.length > preset.maxShots) {
    issues.push({
      code: 'multi-shot-shot-count-out-of-range',
      severity,
      message: `too many shots: ${shots.length} > preset.maxShots=${preset.maxShots} (preset "${preset.name}")`,
    });
  }

  // Consecutive-parameter repetition (size, lens, angle, movement).
  let prev: { size?: string; lens?: string; angle?: string; move?: string } = {};
  for (let i = 0; i < shots.length; i += 1) {
    const size = firstMatch(shots[i].line, MULTI_SHOT_SHOT_SIZES);
    const lens = firstMatch(shots[i].line, MULTI_SHOT_LENSES);
    const angle = firstMatch(shots[i].line, MULTI_SHOT_ANGLES);
    const move = firstMatch(shots[i].line, [...CAMERA_MOVE_VOCABULARY]);
    if (i > 0) {
      for (const [label, cur, was] of [
        ['shot size', size, prev.size],
        ['lens', lens, prev.lens],
        ['angle', angle, prev.angle],
        ['movement', move, prev.move],
      ] as const) {
        if (cur && was && cur === was) {
          issues.push({
            code: 'multi-shot-repeated-parameter',
            severity,
            message: `shot ${i + 1} repeats ${label} "${cur}" from the previous shot`,
          });
        }
      }
    }
    prev = { size, lens, angle, move };
  }

  return issues;
}
