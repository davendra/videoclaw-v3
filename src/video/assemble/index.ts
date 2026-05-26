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

// Sub-slice 3i: the assemble-stage orchestrator + typed assemble-report writer.
export { assembleProject, writeAssembleReport } from './assemble.js';

// Sub-slice 3b: TTS (text->speech narration).
export { generateTts } from './tts.js';
export type {
  TtsInput,
  TtsResult,
  TtsSegment,
  TtsSceneOutput,
} from './tts.js';

// Sub-slice 3c: PDF slide extraction (rasterize PDF pages to images).
export { extractPdfSlides, slideImageFilename } from './pdf.js';
export type {
  ExtractPdfSlidesInput,
  ExtractPdfSlidesResult,
  ExtractedPdfPage,
  SlideImageFormat,
} from './pdf.js';

// Sub-slice 3d: title-card generation (SVG text composited over a base via sharp).
export { generateTitleCard } from './title-card.js';
export type {
  GenerateTitleCardInput,
  GenerateTitleCardResult,
} from './title-card.js';

// Sub-slice 3e: shared FFmpeg helper (spawn wrapper + ffprobe duration) and
// slide-animation arg-builder. Pure arg-builders are the tested surface;
// actual ffmpeg execution is integration-only (human-verified).
export {
  runFfmpeg,
  ffprobeDuration,
  resolveFfmpegBin,
  resolveFfprobeBin,
  STANDARD_VIDEO_ARGS,
  STANDARD_AUDIO_ARGS,
} from './ffmpeg.js';
export type {
  RunFfmpegOptions,
  RunFfmpegResult,
  FfprobeDurationOptions,
} from './ffmpeg.js';

export {
  buildAnimateArgs,
  animateSlide,
  alignDurationToFrame,
  DEFAULT_FADE_DURATION_SEC,
  TARGET_WIDTH,
  TARGET_HEIGHT,
  TARGET_FPS,
  APAD_SAFETY_SEC,
} from './animate-slides.js';
export type {
  BuildAnimateArgsInput,
  AnimateSlideResult,
} from './animate-slides.js';

// Sub-slice 3f: background-music generation (Kie.ai Suno; submit -> poll -> download).
export { generateMusic, resolveMusicApiKey } from './music.js';
export type {
  GenerateMusicInput,
  GenerateMusicResult,
} from './music.js';

// Sub-slice 3g: QA modules (advisory, pure-local; Gemini-vision deferred).
export {
  lintDialogue,
  countWords,
  STANDARD_MAX_WORDS,
  STANDARD_RECOMMENDED_WORDS,
  SIGNOFF_SCENE_INDEX,
  SIGNOFF_MAX_WORDS,
  SIGNOFF_RECOMMENDED_WORDS,
} from './qa-dialogue-lint.js';
export type {
  DialogueSegment,
  LintDialogueInput,
  LintDialogueResult,
  DialogueWarning,
} from './qa-dialogue-lint.js';

export {
  checkNarration,
  countNarrationWords,
  MIN_NARRATION_CHARS,
  DEFAULT_MAX_NARRATION_WORDS,
  WORDS_PER_SECOND,
} from './qa-narration.js';
export type {
  NarrationScene,
  CheckNarrationInput,
  CheckNarrationResult,
  NarrationWarning,
} from './qa-narration.js';

export {
  checkImageFilter,
  classifyImagePrompt,
  VERDICT_ORDER,
  RISK_CATEGORIES,
} from './qa-image-filter.js';
export type {
  FilterVerdict,
  ImageFilterCandidate,
  CheckImageFilterInput,
  CheckImageFilterResult,
  ImageFilterWarning,
} from './qa-image-filter.js';

// Sub-slice 3h: stitch keystone — concat-demuxer (primary) + concat-filter
// fallback + music-bed mix. Pure arg-builders are the tested surface; the final
// MP4 quality check is a human integration checkpoint (ffmpeg never run in tests).
export {
  stitch,
  orderedSegments,
  selectConcatStrategy,
  buildConcatListContent,
  buildConcatDemuxerArgs,
  buildConcatFilterArgs,
  buildMusicMixArgs,
  FILTER_FALLBACK_SEGMENT_THRESHOLD,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_MUSIC_FADE_OUT_SEC,
  STANDARD_AUDIO_BITRATE,
} from './stitch.js';
export type {
  ConcatStrategy,
  MusicMixSettings,
  StitchInput,
  StitchPlannedStep,
  StitchResult,
  StitchOptions,
  BuildConcatFilterOptions,
  BuildMusicMixOptions,
} from './stitch.js';
