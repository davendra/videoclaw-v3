/**
 * Standing prompt rules — pure, deterministic prompt-fragment scrubbers.
 *
 * No I/O, no network. Each helper enforces a "standing rule" that should
 * hold across every provider prompt:
 *   - proper names get swapped for stable visual descriptors,
 *   - brand tokens get neutralised away,
 *   - identity-drift and audio-source rules get appended verbatim.
 */

export interface CastDescriptor {
  name: string;
  descriptor: string;
}

/** Escape regex metacharacters so a name is matched literally. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace each cast `name` with its `descriptor` using word-boundary,
 * case-sensitive matching. Substrings inside larger words are left intact
 * (e.g. "Mee" does not clobber "Meera").
 */
export function stripProperNames(text: string, cast: CastDescriptor[]): string {
  let out = text;
  for (const { name, descriptor } of cast) {
    if (!name) {
      continue;
    }
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
    out = out.replace(re, descriptor);
  }
  return out;
}

/**
 * Remove brand tokens (word-boundary, case-insensitive) so the result no
 * longer contains the brand name. Each token is replaced with a neutral
 * descriptor and any doubled/leading/trailing whitespace is collapsed.
 */
export function brandNeutralize(text: string, brands: string[]): string {
  let out = text;
  for (const brand of brands) {
    if (!brand) {
      continue;
    }
    const re = new RegExp(`\\b${escapeRegExp(brand)}\\b`, 'gi');
    out = out.replace(re, 'generic unbranded');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** Standing rule: forbid identity drift / face morphing across frames. */
export function noFaceMorphTag(): string {
  return 'no face morphing, no identity drift — keep facial features stable across all frames';
}

/** Standing rule: diegetic audio only (no scored/added music or VO). */
export function diegeticAudioLine(): string {
  return 'Audio: Diegetic sound only — natural ambience, environmental foley, and subject-driven sound.';
}
