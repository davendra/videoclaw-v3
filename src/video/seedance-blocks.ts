/**
 * Joey-style Seedance block emitters: Subject Lock / Frame Map / Cross-Frame /
 * Last Frame. Pure/deterministic — no I/O.
 *
 * WS0 binding probe (docs/superpowers/notes/ark-reference-order-result.md) is
 * unresolved ("unknown"), so `@imageN` slots are emitted as GUIDANCE ONLY: the
 * slot labels are descriptive hints, not a hard positional binding contract.
 */

/**
 * WS0 reference-order binding mode. Resolved to `false` because the WS0 probe
 * result is `unknown` (no `binding: positional` confirmation): treat `@imageN`
 * as guidance only, never as a hard positional binding.
 */
export const POSITIONAL_BINDING = false;

export interface SubjectLockEntry {
  label: string;   // visual descriptor, NOT a proper name
  slot: string;    // e.g. '@image1'
}

export interface FrameMapEntry {
  t: string;       // timecode range
  beat: string;
}

/** FRAME MAP — ordered beats with timecodes. */
export function frameMapBlock(entries: FrameMapEntry[]): string {
  const lines = entries.map((e) => `  ${e.t}: ${e.beat}`).join('\n');
  return `FRAME MAP:\n${lines}`;
}

/** SUBJECT LOCK — per-character identity binding to @imageN slots. */
export function subjectLockBlock(entries: SubjectLockEntry[]): string {
  if (entries.length === 0) {
    return 'SUBJECT LOCK: preserve the primary subject identical across every frame.';
  }
  const lines = entries.map((e) => `  ${e.slot}: ${e.label} — lock this identity, do not alter.`).join('\n');
  return `SUBJECT LOCK:\n${lines}`;
}

/** CROSS-FRAME RULES — identity/geography stability across cuts. */
export function crossFrameBlock(): string {
  return 'CROSS-FRAME RULES: face, hair, wardrobe, silhouette, palette, and geography stay identical across every cut; lighting logic and lens language established once and held.';
}

/** LAST FRAME — closing composition lock + sanctioned text suppression. */
export function lastFrameBlock(closing: string): string {
  return `LAST FRAME: ${closing}. No on-screen text, no captions, no signage typography, no rendered text in the frame.`;
}
