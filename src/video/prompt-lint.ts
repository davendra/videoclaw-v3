/**
 * prompt-lint — a PURE, deterministic validator over a filmmaking-prompts
 * artifact. No I/O, no Date, no Math.random: the CLI handler reads the artifact
 * (from a project or a `--file`) and hands the parsed object here.
 *
 * Per Seedance packet it checks:
 *   - 10-block order (text-driven packets only) via {@link checkSeedanceBlockOrder};
 *   - word count (warn outside the 280-600 words/packet window);
 *   - brand / proper-name scrub leaks (reuses the prompt-rules scrubbers);
 *   - the single-full-frame grid guard is present whenever a storyboard-grid
 *     reference is attached (else the grid leaks as a moving split-screen);
 *   - SUBJECT LOCK + CAPTURE REALISM + CAMERA CAPTURE present on every video packet;
 *   - no Kelvin / hue° numeric-register tokens in a prose-register packet.
 *
 * Output is machine-readable: `{ packets: [{ sceneIndex, issues[] }], ok }`,
 * where `ok` is true iff no `error`-severity issue was raised on any packet.
 */

import { checkSeedanceBlockOrder, type FilmmakingPromptsArtifact, type FilmmakingSeedancePacket } from './filmmaking-prompts.js';
import { SINGLE_FULL_FRAME_GUARD } from './seedance-blocks.js';
import { brandNeutralize, stripProperNames, type CastDescriptor } from './prompt-rules.js';

/** Words-per-packet advisory window. Outside this range raises a warning. */
export const PROMPT_LINT_MIN_WORDS = 280;
export const PROMPT_LINT_MAX_WORDS = 600;

/** Blocks that must appear on every video (Seedance) packet. */
const REQUIRED_VIDEO_BLOCKS = ['SUBJECT LOCK', 'CAPTURE REALISM', 'CAMERA CAPTURE'] as const;

export type PromptLintIssueCode =
  | 'seedance-block-order'
  | 'word-count'
  | 'missing-required-block'
  | 'grid-guard-missing'
  | 'numeric-in-prose'
  | 'proper-name-leak'
  | 'brand-leak';

export interface PromptLintIssue {
  code: PromptLintIssueCode;
  severity: 'warning' | 'error';
  message: string;
}

export interface PromptLintPacketResult {
  sceneIndex: number;
  issues: PromptLintIssue[];
}

export interface PromptLintResult {
  packets: PromptLintPacketResult[];
  ok: boolean;
}

export interface PromptLintOptions {
  /**
   * Cinematography register the packets were rendered in. Default `'prose'`
   * (the Joey hard default): in prose register, Kelvin (`5200K`) and hue/angle
   * degree tokens (`40°`) are numeric-register leakage and get flagged. Pass
   * `'numeric'` to suppress that check when numeric tokens are intentional.
   */
  register?: 'prose' | 'numeric';
  /**
   * Cast name → visual-descriptor map. When provided, a packet whose text still
   * contains a proper name (i.e. {@link stripProperNames} would change it) is
   * flagged as a proper-name leak. Omitted → the proper-name check is skipped.
   */
  cast?: CastDescriptor[];
  /**
   * Brand tokens to scrub. When provided, a packet whose text still contains a
   * brand (i.e. {@link brandNeutralize} would change it) is flagged. Omitted →
   * the brand check is skipped.
   */
  brands?: string[];
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Lint a single packet, returning its ordered issue list. */
function lintPacket(
  packet: FilmmakingSeedancePacket,
  options: PromptLintOptions,
): PromptLintIssue[] {
  const issues: PromptLintIssue[] = [];
  const text = packet.promptText;

  // 1) Block order — only the text-driven packet follows the 10-block contract;
  //    grid variants intentionally use the grid-reference body shape.
  if (packet.variant === 'text-driven') {
    const blockIssue = checkSeedanceBlockOrder(text);
    if (blockIssue) {
      issues.push({ code: 'seedance-block-order', severity: 'warning', message: blockIssue.message });
    }
  }

  // 2) Word count window (advisory).
  const words = wordCount(text);
  if (words < PROMPT_LINT_MIN_WORDS || words > PROMPT_LINT_MAX_WORDS) {
    issues.push({
      code: 'word-count',
      severity: 'warning',
      message: `packet is ${words} words; target ${PROMPT_LINT_MIN_WORDS}-${PROMPT_LINT_MAX_WORDS} words per packet.`,
    });
  }

  // 3) Required video blocks must be present on every text-driven packet. Only
  //    the text-driven variant follows the 10-block contract; the grid-reference
  //    variants intentionally use the grid-reference body shape (which carries
  //    the same identity discipline inline, not as labelled SUBJECT LOCK / etc.
  //    blocks), so applying this check to them would be a false positive.
  if (packet.variant === 'text-driven') {
    for (const block of REQUIRED_VIDEO_BLOCKS) {
      if (!text.includes(block)) {
        issues.push({
          code: 'missing-required-block',
          severity: 'error',
          message: `packet is missing the required "${block}" block.`,
        });
      }
    }
  }

  // 4) Grid guard present whenever a storyboard-grid reference is attached.
  const hasGridRef = packet.references.some((reference) => reference.role === 'storyboard-grid');
  if (hasGridRef && !text.includes(SINGLE_FULL_FRAME_GUARD)) {
    issues.push({
      code: 'grid-guard-missing',
      severity: 'error',
      message: 'a storyboard-grid reference is attached but the single-full-frame guard is missing; the grid will leak as a moving split-screen.',
    });
  }

  // 5) No Kelvin / hue° numeric-register tokens in a prose-register packet.
  if ((options.register ?? 'prose') === 'prose') {
    const kelvin = text.match(/\b\d+\s?K\b/g) ?? [];
    const degrees = text.match(/\d+°/g) ?? [];
    const tokens = [...kelvin, ...degrees];
    if (tokens.length > 0) {
      issues.push({
        code: 'numeric-in-prose',
        severity: 'error',
        message: `prose-register packet contains numeric-register tokens (${tokens.join(', ')}); use the prose register or pass register=numeric.`,
      });
    }
  }

  // 6) Proper-name leak — the scrubbed text must equal the original.
  if (options.cast && options.cast.length > 0) {
    if (stripProperNames(text, options.cast) !== text) {
      issues.push({
        code: 'proper-name-leak',
        severity: 'error',
        message: 'packet still contains a cast proper name; describe subjects by visual descriptor, never by name.',
      });
    }
  }

  // 7) Brand leak — the brand-neutralised text must equal the original (modulo
  //    whitespace collapse, which brandNeutralize always applies).
  if (options.brands && options.brands.length > 0) {
    const collapsed = text.replace(/\s{2,}/g, ' ').trim();
    if (brandNeutralize(text, options.brands) !== collapsed) {
      issues.push({
        code: 'brand-leak',
        severity: 'error',
        message: 'packet still contains a brand token; keep prompts brand-neutral.',
      });
    }
  }

  return issues;
}

/**
 * Lint every Seedance packet in a filmmaking-prompts artifact. Pure: depends
 * only on its arguments.
 */
export function lintFilmmakingPrompts(
  artifact: FilmmakingPromptsArtifact,
  options: PromptLintOptions = {},
): PromptLintResult {
  const packets = artifact.seedancePackets.map((packet) => ({
    sceneIndex: packet.sceneIndex,
    issues: lintPacket(packet, options),
  }));
  const ok = packets.every((packet) => packet.issues.every((issue) => issue.severity !== 'error'));
  return { packets, ok };
}
