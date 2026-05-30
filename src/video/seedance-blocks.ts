/**
 * Joey-style Seedance block emitters: Subject Lock / Frame Map / Cross-Frame /
 * Last Frame. Pure/deterministic — no I/O.
 *
 * WS0 binding probe (docs/superpowers/notes/ark-reference-order-result.md) is
 * RESOLVED positional: per UseAPI docs + production ARK payloads (2026-05-30),
 * all three gateways honor reference ORDER as the `@imageN` mapping, so `@imageN`
 * slots are emitted as a HARD positional binding contract — the slot label is the
 * reference-order key, not a descriptive hint.
 */

import { noFaceMorphTag } from './prompt-rules.js';

/**
 * WS0 reference-order binding mode. Resolved to `true`: positional binding is
 * confirmed (UseAPI docs + production ARK payloads, 2026-05-30 — all three
 * gateways honor reference ORDER as the `@imageN` mapping). `@imageN` is a hard
 * positional reference-order contract, not guidance only.
 */
export const POSITIONAL_BINDING = true;

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

// ---------------------------------------------------------------------------
// Text-discipline emitters (WS-C). The canonical multi-reference discipline
// proven by the user's ARK payloads, factored as pure helpers so the same
// wording is reused everywhere (and never drifts). All are opt-in: callers gate
// them behind a flag so default output stays byte-stable.
// ---------------------------------------------------------------------------

/**
 * Positional placements for {@link buildPositionalDescriptorLine}. Index 0 is
 * the hero/centre, then the frame is read outward L/R. Matches the ARK habit of
 * naming where each subject sits ("Center: …. Left: …. Right: ….").
 */
const POSITIONAL_PLACEMENTS = [
  'Center',
  'Left',
  'Right',
  'Far left',
  'Far right',
  'Background left',
  'Background right',
  'Background center',
  'Foreground',
] as const;

const POSITIONAL_FALLBACK_DESCRIPTOR = 'as established in the reference image';

/**
 * Per-character POSITIONAL visual-descriptor line. Each subject is placed at a
 * frame position (Center / Left / Right / …) carrying its VISUAL DESCRIPTOR
 * (`entry.label`) — never a proper name. A missing descriptor falls back to a
 * stable "as established in the reference image" so the slot still reads. Returns
 * `''` for an empty list so single-subject / character-free scenes add nothing.
 */
export function buildPositionalDescriptorLine(entries: SubjectLockEntry[]): string {
  if (entries.length === 0) return '';
  return entries
    .map((entry, index) => {
      const placement = POSITIONAL_PLACEMENTS[index] ?? `Subject ${index + 1}`;
      const descriptor = entry.label.trim() || POSITIONAL_FALLBACK_DESCRIPTOR;
      return `${placement}: ${descriptor}.`;
    })
    .join(' ');
}

/**
 * Explicit identity-lock / no-face-morph discipline line. Reuses the standing
 * {@link noFaceMorphTag} rule (prompt-rules) so the "no face morphing" wording
 * stays canonical across surfaces.
 */
export function buildIdentityLockLine(): string {
  return `Keep each character identical to her reference image, ${noFaceMorphTag().split(',')[0]}.`;
}

/**
 * Single-full-frame guard: forces the model to perform grid panels over time
 * instead of reproducing a 3x3 collage as a moving split-screen. Shared between
 * the grid-bearing packet variants and the opt-in text-discipline path so every
 * multi-reference packet can carry the same guard text.
 * See multi-shot-framework Anti-patterns ("Grid leakage").
 */
export const SINGLE_FULL_FRAME_GUARD =
  'Output a single full-frame cinematic shot that fills the entire frame edge to edge — no 3x3 grid, no split-screen, no panel borders, no collage, no multi-panel montage. The storyboard grid is reference ONLY; perform its panels as consecutive moments over time, never as one image.';

/** LAST FRAME — closing composition lock + sanctioned text suppression. */
export function lastFrameBlock(closing: string): string {
  return `LAST FRAME: ${closing}. No on-screen text, no captions, no signage typography, no rendered text in the frame.`;
}
