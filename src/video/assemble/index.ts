/**
 * Public surface for the assemble stage (`vclaw video assemble`).
 *
 * Sub-slice 3a: re-exports shared types only. Subsequent sub-slices
 * (3b–3h) add module re-exports (tts, pdf, title-card, animate-slides,
 * music, stitch) here as they land.
 */
export type {
  AssembleInput,
  AssembleManifestEntry,
  AssembleResult,
} from './types.js';
