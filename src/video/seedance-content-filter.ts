/**
 * Seedance 2.0 content-filter logic.
 *
 * A faithful TypeScript port of the content-filter functions in
 * `skills/video-replicator/scripts/seedance_client.py`
 * (pre_validate_prompt, sanitize_prompt L1/L2, is_content_violation,
 * _suggest_recovery). Pure and deterministic — no I/O, no network.
 *
 * Seedance enforces strict server-side safety filters (prompt scan + input
 * analysis). Filters tightened significantly after launch due to Hollywood IP
 * backlash, deepfake concerns, and Chinese regulatory requirements. Risk
 * categories (per the source skill):
 *
 *   HIGH RISK (almost always blocked):
 *   - Real human faces/photos as reference images
 *   - Children/minors
 *   - Celebrity/public figure names or strong likenesses
 *   - Copyrighted characters/IP (Marvel, Disney, Star Wars, anime named, ...)
 *   - NSFW / nudity / sexual / suggestive content
 *   - Political figures or sensitive political topics
 *
 *   MEDIUM RISK (sometimes blocked, retry with sanitization):
 *   - Realistic human figures without stylization cues
 *   - Brand names, trademarks, product names
 *   - Violence/combat (graphic)
 *
 *   SAFE (reliable):
 *   - Generic "young adult figure", "elegant dancer", "athletic person"
 *   - Fully stylized: anime, cartoon, 3D render, illustration, painting
 *   - Camera/motion descriptors: dolly, pan, push in, slow zoom, cinematic
 *   - Environment/nature/architecture without identifiable real places
 */

export type ContentFilterLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ContentFilterWarning {
  level: ContentFilterLevel;
  reason: string;
  match: string;
}

// ============================================================================
// Content Violation Detection
// ============================================================================

// Content violation errors from Chinese content moderation (retryable with
// sanitization). Ported verbatim from _CONTENT_VIOLATION_PATTERNS.
const CONTENT_VIOLATION_PATTERNS: string[] = [
  'content violates regulations',
  'violates regulations',
  'error code: 2038',
  'error code:2038',
  '违规', // Chinese: "violation"
  '内容违规', // Chinese: "content violation"
  '内容不合规', // Chinese: "content non-compliant"
  '审核不通过', // Chinese: "review failed"
  '内容安全', // Chinese: "content safety"
  '触发安全', // Chinese: "triggered safety"
];

// Regex for media references that must be preserved during sanitization.
const MEDIA_REF_PATTERN = /@(?:image|video|audio)\d+/g;

// Patterns for brand/product names and marketing language.
const BRAND_PATTERNS: RegExp[] = [
  /\b[A-Z][a-z]+[A-Z]\w*\b/g, // CamelCase: ChronoLux, SmartWatch
  /\b[A-Z]{2,}(?:\s+[A-Z]{2,})*\b/g, // ALL CAPS multi-word: LUXURY BRAND
  /"[^"]{2,30}"/g, // Quoted names: "ChronoLux"
  /'[^']{2,30}'/g, // Single-quoted names
  /(?:™|®|©)/g, // Trademark symbols
];

const MARKETING_WORDS =
  /\b(?:revolutionary|groundbreaking|world[- ]?class|best[- ]?in[- ]?class|premium|luxury|exclusive|limited[- ]?edition|award[- ]?winning|patented|proprietary|trademarked|branded|signature|unrivaled|unmatched|unparalleled|superior|ultimate|#\d+\s+(?:selling|rated|ranked)|market[- ]?leading|buy\s+now|order\s+today|shop\s+now|get\s+yours|discount|sale|offer|deal|promo|coupon|free\s+shipping)\b/gi;

// High-risk terms: celebrities, copyrighted characters, political figures.
// These are near-certain filter triggers — level 1 sanitization replaces them.
const CELEBRITY_IP_PATTERNS =
  /\b(?:taylor\s+swift|beyoncé|beyonce|selena\s+gomez|ariana\s+grande|tom\s+cruise|brad\s+pitt|leonardo\s+dicaprio|scarlett\s+johansson|elon\s+musk|jeff\s+bezos|bill\s+gates|steve\s+jobs|barack\s+obama|donald\s+trump|vladimir\s+putin|xi\s+jinping|spider[- ]?man|iron\s+man|captain\s+america|thor|hulk|black\s+widow|batman|superman|wonder\s+woman|joker|harley\s+quinn|mickey\s+mouse|minnie\s+mouse|elsa|anna|olaf|moana|simba|darth\s+vader|yoda|luke\s+skywalker|stormtrooper|r2[- ]?d2|harry\s+potter|hermione|dumbledore|voldemort|mario|luigi|pikachu|goku|naruto|luffy|shrek|donkey|fiona|stranger\s+things|eleven|eleven\s+hopper|arcane|jinx|vi\s+jinx|jayce|marvel|avengers|x[- ]?men|dc\s+comics|star\s+wars|disney|pixar|netflix\s+original|hbo\s+max|prime\s+video)\b/gi;

// High-risk: minors / children (highest risk category per ByteDance policy).
const MINOR_PATTERNS =
  /\b(?:child|children|kid|kids|boy|girl|baby|infant|toddler|teenager|teen|adolescent|juvenile|minor|underage|youth|young\s+child|little\s+girl|little\s+boy|school\s+child|school\s+kid|pre[- ]?teen|tween|\d+[- ]?year[- ]?old(?!\s*(?:tree|building|car|wine|whiskey|aged))|age\s+[1-9]\b|age\s+1[0-7]\b)\b/gi;

// Pre-validation risk levels.
const HIGH: ContentFilterLevel = 'HIGH';
const MEDIUM: ContentFilterLevel = 'MEDIUM';
const LOW: ContentFilterLevel = 'LOW';

/**
 * Check if an error message indicates a content regulation violation
 * (error code 2038). These errors come from Seedance's Chinese content
 * moderation and are retryable with prompt sanitization.
 *
 * Port of `is_content_violation`.
 */
export function isContentViolation(errorMsg: string): boolean {
  if (!errorMsg) {
    return false;
  }
  const lower = errorMsg.toLowerCase();
  for (const pattern of CONTENT_VIOLATION_PATTERNS) {
    if (lower.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Check a prompt for likely content filter triggers before submission.
 *
 * Returns a list of warnings, each with `{ level, reason, match }`.
 *   HIGH   — near-certain filter triggers.
 *   MEDIUM — sometimes pass but should be reworded if errors occur.
 *   LOW    — advisory only.
 *
 * Port of `pre_validate_prompt`.
 */
export function preValidatePrompt(prompt: string): ContentFilterWarning[] {
  const warnings: ContentFilterWarning[] = [];

  // HIGH: Celebrity names / copyrighted IP
  let match = firstMatch(CELEBRITY_IP_PATTERNS, prompt);
  if (match) {
    warnings.push({
      level: HIGH,
      reason:
        'Celebrity name or copyrighted character detected. Replace with generic description.',
      match,
    });
  }

  // HIGH: Children / minors (highest priority category per ByteDance policy)
  match = firstMatch(MINOR_PATTERNS, prompt);
  if (match) {
    warnings.push({
      level: HIGH,
      reason:
        "Minor/child reference detected. Use 'young adult' (mid-20s) instead, or remove age.",
      match,
    });
  }

  // HIGH: NSFW / sexual / nudity
  const nsfwTerms =
    /\b(?:nude|naked|nudity|topless|bottomless|nsfw|sexy|sexual|erotic|lingerie|underwear|bikini\s+(?:model|shoot)|intimate\s+(?:scene|moment|touch)|suggestive|revealing\s+(?:outfit|clothing|dress)|cleavage|seductive)\b/gi;
  match = firstMatch(nsfwTerms, prompt);
  if (match) {
    warnings.push({
      level: HIGH,
      reason:
        'NSFW/sexual content detected. Keep characters fully clothed in neutral contexts.',
      match,
    });
  }

  // HIGH: Political figures / sensitive politics
  const politicalTerms =
    /\b(?:president|prime\s+minister|senator|congressman|chancellor|communist\s+party|ccp|politburo|government\s+official|protest|revolution|coup|dictator|regime|propaganda)\b/gi;
  match = firstMatch(politicalTerms, prompt);
  if (match) {
    warnings.push({
      level: HIGH,
      reason: 'Political content detected. Avoid political figures and events entirely.',
      match,
    });
  }

  // MEDIUM: Real human faces as references (flag if prompt strongly implies
  // realistic portraiture)
  const portraitTerms =
    /\b(?:real\s+person|real\s+face|photo[- ]?realistic\s+(?:person|face|human)|portrait\s+photo|headshot|selfie|face\s+swap|deepfake|based\s+on\s+(?:a\s+)?(?:photo|image|picture)\s+of)\b/gi;
  match = firstMatch(portraitTerms, prompt);
  if (match) {
    warnings.push({
      level: MEDIUM,
      reason:
        'Photo-realistic portrait reference detected. Use stylized/illustrated references only.',
      match,
    });
  }

  // MEDIUM: Violence / gore
  const violenceTerms =
    /\b(?:gore|blood(?:y|ied)?|decapitat|dismember|brutal\s+(?:fight|kill|death)|graphic\s+(?:violence|injury|wound)|murder|execution|torture|combat\s+with\s+(?:blood|injury|death)|war\s+crime)\b/gi;
  match = firstMatch(violenceTerms, prompt);
  if (match) {
    warnings.push({
      level: MEDIUM,
      reason:
        "Graphic violence detected. Use 'energetic movement' or 'graceful action' instead.",
      match,
    });
  }

  // MEDIUM: Trademark symbols or very specific brand names
  match = firstMatch(/(?:™|®|©)/g, prompt);
  if (match) {
    warnings.push({
      level: MEDIUM,
      reason: 'Trademark symbol detected. Remove brand marks from prompts.',
      match,
    });
  }

  // LOW: Anime named characters (sometimes flagged post-Feb 2026)
  const animeNamed =
    /\b(?:goku|naruto\s+uzumaki|luffy|sasuke|vegeta|nezuko|tanjiro|levi\s+ackerman|mikasa|eren\s+yeager|jujutsu|demon\s+slayer)\b/gi;
  match = firstMatch(animeNamed, prompt);
  if (match) {
    warnings.push({
      level: LOW,
      reason:
        "Named anime character detected. Use generic 'anime-style warrior/hero' instead.",
      match,
    });
  }

  return warnings;
}

/**
 * Sanitize a prompt to avoid content regulation violations.
 *
 * @param prompt Original prompt text (may contain @image1/@video1/@audio1 refs).
 * @param level  Sanitization aggressiveness:
 *   1 = Light: strip brand names, celebrity/IP names, marketing superlatives,
 *       replace minors with "young adult".
 *   2 = Heavy: reduce to pure camera motion + generic visual description.
 *
 * Media references (@image1, @video1, @audio1) are extracted and re-prefixed
 * at the start (where Seedance expects them).
 *
 * Port of `sanitize_prompt`.
 */
export function sanitizePrompt(prompt: string, level = 1): string {
  // Extract and preserve media references (@image1, @video1, @audio1).
  const mediaRefs = prompt.match(MEDIA_REF_PATTERN) ?? [];
  // Remove media refs from text for processing, rejoin later.
  let text = prompt.replace(MEDIA_REF_PATTERN, '').trim();

  if (level === 1) {
    text = sanitizeLevel1(text);
  } else if (level >= 2) {
    text = sanitizeLevel2(text);
  }

  // Rejoin media refs at the start (where Seedance expects them).
  if (mediaRefs.length > 0) {
    const prefix = mediaRefs.join(' ');
    text = `${prefix} ${text}`.trim();
  }

  return text;
}

/** Light sanitization: strip brand names, celebrity/IP names, marketing language. */
function sanitizeLevel1(input: string): string {
  // Strip celebrity names and copyrighted IP (near-certain filter triggers).
  let text = input.replace(CELEBRITY_IP_PATTERNS, '');

  // Replace minor/child references with a safe generic alternative.
  // Use "young adult" rather than empty string to preserve sentence meaning.
  text = text.replace(MINOR_PATTERNS, 'young adult');

  // Strip brand/product names and marketing superlatives.
  for (const pattern of BRAND_PATTERNS) {
    text = text.replace(pattern, '');
  }
  text = text.replace(MARKETING_WORDS, '');

  // Clean up whitespace artifacts.
  text = text.replace(/\s{2,}/g, ' ');
  text = text.replace(/\s+([,.])/g, '$1');
  text = text.replace(/^[,.\s]+/, '');
  text = text.trim();
  return text;
}

/** Heavy sanitization: reduce to camera motion + generic visual description. */
function sanitizeLevel2(text: string): string {
  const cameraPattern =
    /(?:camera|pan|tilt|dolly|tracking|push|pull|zoom|orbit|crane|aerial|close[- ]?up|wide[- ]?shot|medium[- ]?shot|establish|follow|static|slow[- ]?motion|time[- ]?lapse|forward|backward|left|right|up|down|in|out|smooth|gentle|dramatic|cinematic|sweeping)\s*\w*/gi;
  const cameraFrags = text.match(cameraPattern) ?? [];

  const visualPattern =
    /(?:person|object|product|scene|interior|exterior|room|table|surface|background|light|shadow|color|bright|dark|warm|cool|soft|natural|ambient|golden[- ]?hour|sunset|sunrise|morning|evening|night)\s*\w*/gi;
  const visualFrags = text.match(visualPattern) ?? [];

  const parts: string[] = [];
  if (cameraFrags.length > 0) {
    parts.push(cameraFrags.slice(0, 5).join(' '));
  }
  if (visualFrags.length > 0) {
    parts.push(visualFrags.slice(0, 5).join(' '));
  }

  if (parts.length > 0) {
    return parts.join('. ').trim();
  }

  return 'Smooth camera movement across the scene';
}

/**
 * Suggest a fix based on the error message.
 *
 * Port of `_suggest_recovery` (the `prompt` argument in the Python source is
 * unused, so it is omitted here).
 */
export function suggestRecovery(errorMsg: string): string {
  const msg = (errorMsg ?? '').toLowerCase();
  const suggestions: string[] = [];

  if (msg.includes('real person') || msg.includes('content filter') || msg.includes('2038')) {
    suggestions.push(
      'Upload image to Asset Library first (Asset:// URI bypasses real-person filter)',
    );
  }
  if (msg.includes('celebrity') || msg.includes('public figure')) {
    suggestions.push('Remove celebrity references. Describe the character generically instead');
  }
  if (msg.includes('violence') || msg.includes('gore')) {
    suggestions.push("Reduce violence level. Use 'action sequence' instead of explicit violence");
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    suggestions.push('Try shorter duration (5s instead of 15s) or simpler prompt');
  }
  if (msg.includes('too long') || msg.includes('token')) {
    suggestions.push('Shorten the prompt — remove redundant descriptions');
  }
  if (msg.includes('nsfw') || msg.includes('adult')) {
    suggestions.push('Remove NSFW content. Keep it PG-13 for Seedance');
  }

  if (suggestions.length === 0) {
    suggestions.push('Try simplifying the prompt or using a different scene description');
  }

  return suggestions.join(' | ');
}

/**
 * Run a global regex against `text` once and return the first match string,
 * or `null`. Resets `lastIndex` so the shared global regexes stay stateless
 * across calls (Python's `re.search` has no such statefulness).
 */
function firstMatch(pattern: RegExp, text: string): string | null {
  pattern.lastIndex = 0;
  const m = pattern.exec(text);
  pattern.lastIndex = 0;
  return m ? m[0] : null;
}
