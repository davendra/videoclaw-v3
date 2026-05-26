/**
 * Image content-filter risk heuristics — LOCAL checks only (pure, no I/O).
 *
 * Ported from `skills/video-replicator/scripts/bunty_image_filter_check.py`.
 *
 * The Python original predicts which deck slides will trip Veo's first-frame
 * content filter (warriors with weapons, supernatural figures, dark
 * industrial-noir, combat poses). It does this via a Gemini-Vision call that
 * classifies each slide image as safe|risky|likely-blocked. That vision call
 * needs a GOOGLE_API_KEY, looks at pixels, and is not deterministically
 * testable — so it is DEFERRED (see TODO below).
 *
 * What IS ported: the local, text-based heuristic that scores a slide's
 * *prompt / description* against the same known-risky keyword categories the
 * Python prompt enumerates (weapons, combat poses, supernatural/demonic,
 * industrial-noir). This lets the operator flag at-risk slides from their
 * generation prompts BEFORE any image or F2V generation, cheaply and offline,
 * and mirrors the Python verdict ladder (safe < risky < likely-blocked).
 *
 * This is ADVISORY: it returns warnings rather than throwing. It only throws a
 * VclawError for genuinely invalid input. Pure module: no CLI wiring (3i).
 *
 * TODO(slice-3?/deferred): port `check_image` Gemini-Vision slide
 * classification (verdict: safe|risky|likely-blocked over the actual image
 * pixels). Requires a GOOGLE_API_KEY / GEMINI_API_KEY and a network call; not
 * unit-testable deterministically, so it lives outside this pure module.
 */
import { VclawError } from '../errors.js';

export type FilterVerdict = 'safe' | 'risky' | 'likely-blocked';

/** Severity ordering, mirrors Python VERDICT_ORDER. */
export const VERDICT_ORDER: Record<FilterVerdict, number> = {
  safe: 0,
  risky: 1,
  'likely-blocked': 2,
};

/**
 * Keyword categories matching the Python prompt's flagged-element list. Each
 * category contributes to the risk score. Two distinct categories present, or a
 * high-weight category, escalate the verdict to likely-blocked.
 */
export const RISK_CATEGORIES: Record<string, { weight: number; keywords: string[] }> = {
  weapon: {
    weight: 2,
    keywords: ['sword', 'knife', 'gun', 'rifle', 'pistol', 'blade', 'energy weapon', 'firearm'],
  },
  combatPose: {
    weight: 1,
    keywords: ['fighting stance', 'battle pose', 'combat pose', 'warrior stance', 'fighting pose'],
  },
  supernatural: {
    weight: 2,
    keywords: ['glowing eyes', 'demonic', 'hooded figure', 'dark aura', 'glowing aura', 'energy ball', 'supernatural'],
  },
  industrialNoir: {
    weight: 1,
    keywords: ['rusted metal', 'destroyed environment', 'helmeted silhouette', 'industrial noir', 'dark silhouette'],
  },
};

export interface ImageFilterCandidate {
  sceneIndex: number;
  /**
   * The text used to generate / describe the slide image (prompt or caption).
   * The local heuristic scans this for known-risky keyword categories.
   */
  prompt: string;
}

export interface CheckImageFilterInput {
  candidates: ImageFilterCandidate[];
  /**
   * Flag any candidate at or above this verdict. Default 'risky'. (The Python
   * default is 'likely-blocked', but for a text-only heuristic 'risky' is the
   * safer advisory default; callers can raise it.)
   */
  threshold?: FilterVerdict;
}

export interface ImageFilterWarning {
  sceneIndex: number;
  rule: 'content-filter-risk';
  verdict: FilterVerdict;
  /** Risk categories that matched, e.g. ['weapon', 'supernatural']. */
  categories: string[];
  message: string;
}

export interface CheckImageFilterResult {
  warnings: ImageFilterWarning[];
  ok: boolean;
}

/** Classify one prompt into a verdict + matched categories (pure, local). */
export function classifyImagePrompt(prompt: string): {
  verdict: FilterVerdict;
  categories: string[];
} {
  const hay = prompt.toLowerCase();
  const matched: string[] = [];
  let score = 0;
  for (const [name, { weight, keywords }] of Object.entries(RISK_CATEGORIES)) {
    if (keywords.some((kw) => hay.includes(kw))) {
      matched.push(name);
      score += weight;
    }
  }
  let verdict: FilterVerdict = 'safe';
  if (score >= 2 || matched.length >= 2) verdict = 'likely-blocked';
  else if (score >= 1) verdict = 'risky';
  return { verdict, categories: matched };
}

/**
 * Run the local image-filter heuristic over candidate slide prompts. Advisory:
 * returns warnings, never throws for content. Throws only on invalid input.
 */
export function checkImageFilter(input: CheckImageFilterInput): CheckImageFilterResult {
  if (!input || !Array.isArray(input.candidates)) {
    throw new VclawError(
      'unexpected_internal_error',
      'checkImageFilter: input.candidates must be an array',
    );
  }

  const threshold = input.threshold ?? 'risky';
  const thresholdLevel = VERDICT_ORDER[threshold];
  const warnings: ImageFilterWarning[] = [];

  for (const candidate of input.candidates) {
    if (typeof candidate?.prompt !== 'string') continue;
    const { verdict, categories } = classifyImagePrompt(candidate.prompt);
    if (VERDICT_ORDER[verdict] >= thresholdLevel) {
      warnings.push({
        sceneIndex: candidate.sceneIndex,
        rule: 'content-filter-risk',
        verdict,
        categories,
        message:
          verdict === 'safe'
            ? `Scene ${candidate.sceneIndex}: clean cricket composition.`
            : `Scene ${candidate.sceneIndex}: ${verdict} — flagged ${categories.join(', ')}. Consider softening the composition before F2V to avoid Veo content-filter rejection.`,
      });
    }
  }

  return { warnings, ok: warnings.length === 0 };
}
