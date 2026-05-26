/**
 * Dialogue / lip-sync word-count linter (pure, no I/O).
 *
 * Ported from `skills/video-replicator/scripts/bunty_dialogue_lint.py`.
 *
 * Veo I2V lip-sync clips have a FIXED 8-second duration. Above ~28 words the
 * speech gets cut off mid-sentence (confirmed 2026-05-11). The sign-off scene
 * (scene 21) is tighter — 15-20 words for dramatic pacing.
 *
 * Limits (from bunty-voice-guide.md, codified 2026-05-11):
 *   Standard lip-sync (scenes 17, 19, 20): 24-28 words MAX (recommended <=26)
 *   Sign-off (scene 21):                   15-20 words MAX (recommended <=18)
 *
 * This is ADVISORY: it returns warnings rather than throwing. It only throws a
 * VclawError for genuinely invalid input (non-array segments). The Python
 * file/glob/CLI wiring and ANSI emit are intentionally NOT ported (3i owns CLI).
 *
 * Pure module: no CLI wiring (3i).
 */
import { VclawError } from '../errors.js';

/** Standard lip-sync word ceiling (scenes 17, 19, 20). */
export const STANDARD_MAX_WORDS = 28;
/** Comfortable middle for standard lip-sync. */
export const STANDARD_RECOMMENDED_WORDS = 26;
/** The dramatic sign-off scene index (1-based, matches Python "21"). */
export const SIGNOFF_SCENE_INDEX = 21;
/** Sign-off word ceiling (scene 21). */
export const SIGNOFF_MAX_WORDS = 20;
/** Comfortable middle for the sign-off. */
export const SIGNOFF_RECOMMENDED_WORDS = 18;

export interface DialogueSegment {
  /** Scene index this dialogue line belongs to. */
  sceneIndex: number;
  /** The spoken text for this scene. */
  text: string;
}

export interface LintDialogueInput {
  segments: DialogueSegment[];
  /** Override the standard (non-sign-off) max word count. Default STANDARD_MAX_WORDS. */
  standardMaxWords?: number;
  /** Override the standard recommended word count. Default STANDARD_RECOMMENDED_WORDS. */
  standardRecommendedWords?: number;
  /** Scene index treated as the tighter sign-off. Default SIGNOFF_SCENE_INDEX. */
  signoffSceneIndex?: number;
  /** Override the sign-off max word count. Default SIGNOFF_MAX_WORDS. */
  signoffMaxWords?: number;
  /** Override the sign-off recommended word count. Default SIGNOFF_RECOMMENDED_WORDS. */
  signoffRecommendedWords?: number;
}

export interface DialogueWarning {
  sceneIndex: number;
  /** Stable rule id: 'over-limit' (will be cut off) or 'near-limit' (edge). */
  rule: 'over-limit' | 'near-limit';
  message: string;
  /** Computed word count for the segment. */
  wordCount: number;
}

export interface LintDialogueResult {
  warnings: DialogueWarning[];
  /** True when no over-limit or near-limit warnings were produced. */
  ok: boolean;
}

/**
 * Count tokens that look like words (have at least one letter or digit). This
 * excludes standalone punctuation like em dashes which split on whitespace into
 * their own token but aren't spoken. Hyphenated words count as one.
 *
 * Mirrors the Python `count_words` helper.
 */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Lint dialogue segments against the Veo lip-sync word ceilings. Advisory:
 * returns warnings, never throws for content. Throws only on invalid input.
 */
export function lintDialogue(input: LintDialogueInput): LintDialogueResult {
  if (!input || !Array.isArray(input.segments)) {
    throw new VclawError(
      'unexpected_internal_error',
      'lintDialogue: input.segments must be an array',
    );
  }

  const standardMax = input.standardMaxWords ?? STANDARD_MAX_WORDS;
  const standardRec = input.standardRecommendedWords ?? STANDARD_RECOMMENDED_WORDS;
  const signoffScene = input.signoffSceneIndex ?? SIGNOFF_SCENE_INDEX;
  const signoffMax = input.signoffMaxWords ?? SIGNOFF_MAX_WORDS;
  const signoffRec = input.signoffRecommendedWords ?? SIGNOFF_RECOMMENDED_WORDS;

  const warnings: DialogueWarning[] = [];

  for (const seg of input.segments) {
    if (typeof seg?.text !== 'string') continue;
    const n = countWords(seg.text);
    const isSignoff = seg.sceneIndex === signoffScene;
    const maxWords = isSignoff ? signoffMax : standardMax;
    const recommended = isSignoff ? signoffRec : standardRec;
    const label = isSignoff ? 'sign-off' : 'lip-sync';

    if (n > maxWords) {
      warnings.push({
        sceneIndex: seg.sceneIndex,
        rule: 'over-limit',
        wordCount: n,
        message: `Scene ${seg.sceneIndex} (${label}): ${n} words — OVER LIMIT (${maxWords}). Veo will cut off speech mid-sentence. Trim to <=${recommended}.`,
      });
    } else if (n > recommended) {
      warnings.push({
        sceneIndex: seg.sceneIndex,
        rule: 'near-limit',
        wordCount: n,
        message: `Scene ${seg.sceneIndex} (${label}): ${n} words — at the edge (${maxWords} max). Consider trimming to <=${recommended} for safety.`,
      });
    }
  }

  return { warnings, ok: warnings.length === 0 };
}
