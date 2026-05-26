/**
 * Narration QA — LOCAL checks only (pure, no I/O).
 *
 * Ported from `skills/video-replicator/scripts/bunty_narration_check.py`.
 *
 * The Python original's PRIMARY purpose is a Gemini-Vision slide/narration
 * alignment audit (does slide N's image match scene N's narration?). That
 * vision call needs a GOOGLE_API_KEY and is not deterministically testable, so
 * it is DEFERRED — see the TODO below. What IS ported here are the local,
 * deterministic structural checks the Python script performs around the vision
 * call: per-scene segment presence, narration length/timing math, and
 * slide/narration count alignment (the "NotebookLM compressed/inserted a slide"
 * failure modes the script header describes).
 *
 * This is ADVISORY: it returns warnings rather than throwing. It only throws a
 * VclawError for genuinely invalid input. Pure module: no CLI wiring (3i).
 *
 * TODO(slice-3?/deferred): port `check_slide` Gemini-Vision narration/slide
 * alignment classification (verdict: aligned|partial|mismatch). Requires a
 * GOOGLE_API_KEY / GEMINI_API_KEY and a network call; not unit-testable
 * deterministically, so it lives outside this pure module.
 */
import { VclawError } from '../errors.js';

/** Empty/whitespace-only narration is flagged. */
export const MIN_NARRATION_CHARS = 1;
/** Per-scene narration words above this risk overrunning the slide's on-screen time. */
export const DEFAULT_MAX_NARRATION_WORDS = 60;
/** Approximate spoken words-per-second used for the timing estimate. */
export const WORDS_PER_SECOND = 2.5;

export interface NarrationScene {
  sceneIndex: number;
  /** Planned narration text for this scene. */
  narration: string;
}

export interface CheckNarrationInput {
  scenes: NarrationScene[];
  /**
   * Number of slide images available. When provided, a mismatch against the
   * narration scene count is flagged (the NotebookLM compress/insert failure).
   */
  slideCount?: number;
  /** Per-scene narration word ceiling. Default DEFAULT_MAX_NARRATION_WORDS. */
  maxNarrationWords?: number;
  /**
   * Optional per-scene on-screen budget in seconds. When set, a scene whose
   * estimated spoken duration exceeds its budget is flagged (timing math).
   */
  slideDurationSec?: number;
  /** Override the spoken words-per-second estimate. Default WORDS_PER_SECOND. */
  wordsPerSecond?: number;
}

export interface NarrationWarning {
  /** -1 for whole-deck (structural) warnings not tied to a single scene. */
  sceneIndex: number;
  /**
   * Stable rule id:
   *  'empty-narration' — scene has no narration text
   *  'over-length'     — narration exceeds the per-scene word ceiling
   *  'timing-overrun'  — estimated spoken time exceeds the slide budget
   *  'count-mismatch'  — narration scene count != slide count
   */
  rule: 'empty-narration' | 'over-length' | 'timing-overrun' | 'count-mismatch';
  message: string;
}

export interface CheckNarrationResult {
  warnings: NarrationWarning[];
  ok: boolean;
}

/** Count whitespace-delimited word tokens that contain a letter or digit. */
export function countNarrationWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Run the local narration checks. Advisory: returns warnings, never throws for
 * content. Throws only on invalid input.
 */
export function checkNarration(input: CheckNarrationInput): CheckNarrationResult {
  if (!input || !Array.isArray(input.scenes)) {
    throw new VclawError(
      'unexpected_internal_error',
      'checkNarration: input.scenes must be an array',
    );
  }

  const maxWords = input.maxNarrationWords ?? DEFAULT_MAX_NARRATION_WORDS;
  const wps = input.wordsPerSecond ?? WORDS_PER_SECOND;
  const warnings: NarrationWarning[] = [];

  for (const scene of input.scenes) {
    if (typeof scene?.narration !== 'string') continue;
    const trimmed = scene.narration.trim();

    if (trimmed.length < MIN_NARRATION_CHARS) {
      warnings.push({
        sceneIndex: scene.sceneIndex,
        rule: 'empty-narration',
        message: `Scene ${scene.sceneIndex}: narration is empty.`,
      });
      continue;
    }

    const n = countNarrationWords(trimmed);
    if (n > maxWords) {
      warnings.push({
        sceneIndex: scene.sceneIndex,
        rule: 'over-length',
        message: `Scene ${scene.sceneIndex}: ${n} words — exceeds the per-scene ceiling (${maxWords}); narration may run ahead of visuals.`,
      });
    }

    if (input.slideDurationSec !== undefined && input.slideDurationSec > 0) {
      const estSec = n / wps;
      if (estSec > input.slideDurationSec) {
        warnings.push({
          sceneIndex: scene.sceneIndex,
          rule: 'timing-overrun',
          message: `Scene ${scene.sceneIndex}: ~${estSec.toFixed(1)}s of narration (${n} words at ${wps} w/s) exceeds the ${input.slideDurationSec}s slide budget.`,
        });
      }
    }
  }

  // Slide / narration count alignment (NotebookLM compress / insert failure).
  if (input.slideCount !== undefined && input.slideCount !== input.scenes.length) {
    warnings.push({
      sceneIndex: -1,
      rule: 'count-mismatch',
      message: `Narration scene count (${input.scenes.length}) does not match slide count (${input.slideCount}); narration may drift relative to visuals.`,
    });
  }

  return { warnings, ok: warnings.length === 0 };
}
