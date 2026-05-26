/**
 * Shared types for the `vclaw video assemble` post-execution stage.
 *
 * Sub-slice 3a establishes only the structural surface. The actual
 * TTS / PDF / title-card / slide-animation / music / stitch logic lands
 * in sub-slices 3b–3h. No video/audio I/O lives here yet.
 */
import type { VideoProjectWorkspace } from '../workspace.js';

export interface AssembleInput {
  workspace: VideoProjectWorkspace;
  /** Path to the brand-profile.json for the active presenter (Slice 2 output). */
  brandProfilePath?: string;
  /** Optional override of FFmpeg path. Defaults to `ffmpeg` on PATH. */
  ffmpegBin?: string;
  /** Dry run produces the report but skips actual generation. */
  dryRun?: boolean;
}

export interface AssembleManifestEntry {
  kind: 'narration' | 'music' | 'title-card' | 'slide-animation' | 'final-video';
  path: string;
  durationMs: number;
  sceneIndex?: number;
  sizeBytes: number;
  generator: string;
}

export interface AssembleResult {
  status: 'complete' | 'partial' | 'dry-run';
  outputPath: string;
  manifest: AssembleManifestEntry[];
  events: string[];
  warnings: string[];
}
