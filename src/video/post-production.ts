import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { probeMedia, resolveProjectFinalPath } from './final-media.js';

const execFileAsync = promisify(execFile);

type ProjectOrFileOptions = {
  projectSlug?: string;
  filePath?: string;
  root?: string;
};

export interface VideoVariantResult {
  projectSlug?: string;
  variant: 'vertical' | 'square' | 'loop';
  sourcePath: string;
  outputPath: string;
  durationSeconds?: number;
  sizeBytes?: number;
  videoCodec?: string;
  width?: number;
  height?: number;
  frameRate?: string;
  audioPresent: boolean;
  audioCodec?: string;
}

export interface VideoThumbnailResult {
  projectSlug?: string;
  sourcePath: string;
  outputPath: string;
  timestampSeconds: number;
  text?: string;
  overlayApplied: boolean;
}

export interface VideoSubtitleBurnResult {
  projectSlug?: string;
  sourcePath: string;
  subtitlePath: string;
  outputPath: string;
  burnedIn: boolean;
  durationSeconds?: number;
  sizeBytes?: number;
  videoCodec?: string;
  width?: number;
  height?: number;
  frameRate?: string;
  audioPresent: boolean;
  audioCodec?: string;
}

function buildDefaultOutputPath(sourcePath: string, suffix: string, extension = extname(sourcePath)): string {
  return join(dirname(sourcePath), `${basename(sourcePath, extname(sourcePath))}-${suffix}${extension}`);
}

async function resolveSourcePath(options: ProjectOrFileOptions): Promise<string> {
  const root = options.root ?? process.cwd();
  return options.filePath
    ?? (options.projectSlug ? await resolveProjectFinalPath(options.projectSlug, root) : '')
    ?? '';
}

function assertSourcePath(path: string): string {
  if (!path) {
    throw new Error('post-production requires either projectSlug or filePath');
  }
  return path;
}

function escapeDrawtextText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,');
}

function escapeSubtitleFilterPath(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

async function ffmpegSupportsFilter(filterName: string): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf-8' });
    return new RegExp(`\\b${filterName}\\b`).test(`${stdout}\n${stderr}`);
  } catch {
    return false;
  }
}

export async function makeVideoVariant(options: ProjectOrFileOptions & {
  variant: 'vertical' | 'square' | 'loop';
  outputPath?: string;
}): Promise<VideoVariantResult> {
  const sourcePath = assertSourcePath(await resolveSourcePath(options));
  const outputPath = options.outputPath ?? buildDefaultOutputPath(sourcePath, options.variant);
  await mkdir(dirname(outputPath), { recursive: true });

  if (options.variant === 'vertical') {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', sourcePath,
      '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '192k',
      outputPath,
    ], { encoding: 'utf-8' });
  } else if (options.variant === 'square') {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', sourcePath,
      '-vf', 'scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '192k',
      outputPath,
    ], { encoding: 'utf-8' });
  } else {
    const sourceMetadata = await probeMedia(sourcePath);
    const filterComplex = sourceMetadata.audioPresent
      ? '[0:v]split[vf][vr];[vr]reverse[rev];[vf][rev]concat=n=2:v=1:a=0[vout];[0:a]asplit[af][ar];[ar]areverse[arev];[af][arev]concat=n=2:v=0:a=1[aout]'
      : '[0:v]split[vf][vr];[vr]reverse[rev];[vf][rev]concat=n=2:v=1:a=0[vout]';
    const args = [
      '-y',
      '-i', sourcePath,
      '-filter_complex', filterComplex,
      '-map', '[vout]',
    ];
    if (sourceMetadata.audioPresent) {
      args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
    }
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', outputPath);
    await execFileAsync('ffmpeg', args, { encoding: 'utf-8' });
  }

  const metadata = await probeMedia(outputPath);
  return {
    ...(options.projectSlug ? { projectSlug: options.projectSlug } : {}),
    variant: options.variant,
    sourcePath,
    outputPath,
    ...metadata,
  };
}

export async function createVideoThumbnail(options: ProjectOrFileOptions & {
  outputPath?: string;
  text?: string;
}): Promise<VideoThumbnailResult> {
  const sourcePath = assertSourcePath(await resolveSourcePath(options));
  const outputPath = options.outputPath ?? buildDefaultOutputPath(sourcePath, 'thumbnail', '.jpg');
  await mkdir(dirname(outputPath), { recursive: true });

  const metadata = await probeMedia(sourcePath);
  const timestampSeconds = Math.max(0, (metadata.durationSeconds ?? 0) / 2);
  const text = options.text?.trim() ? options.text.trim() : undefined;

  if (!text) {
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss', String(timestampSeconds),
      '-i', sourcePath,
      '-frames:v', '1',
      '-update', '1',
      outputPath,
    ], { encoding: 'utf-8' });
    return {
      ...(options.projectSlug ? { projectSlug: options.projectSlug } : {}),
      sourcePath,
      outputPath,
      timestampSeconds,
      overlayApplied: false,
    };
  }

  const drawtextAvailable = await ffmpegSupportsFilter('drawtext');
  if (drawtextAvailable) {
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss', String(timestampSeconds),
        '-i', sourcePath,
        '-vf',
        `drawbox=x=0:y=ih-180:w=iw:h=180:color=black@0.45:t=fill,drawtext=text='${escapeDrawtextText(text)}':x=60:y=h-120:fontsize=56:fontcolor=white`,
        '-frames:v', '1',
        '-update', '1',
        outputPath,
      ], { encoding: 'utf-8' });
      return {
        ...(options.projectSlug ? { projectSlug: options.projectSlug } : {}),
        sourcePath,
        outputPath,
        timestampSeconds,
        text,
        overlayApplied: true,
      };
    } catch {
      // Fall back to a plain frame when drawtext is unavailable at runtime.
    }
  }

  await execFileAsync('ffmpeg', [
    '-y',
    '-ss', String(timestampSeconds),
    '-i', sourcePath,
    '-frames:v', '1',
    '-update', '1',
    outputPath,
  ], { encoding: 'utf-8' });
  return {
    ...(options.projectSlug ? { projectSlug: options.projectSlug } : {}),
    sourcePath,
    outputPath,
    timestampSeconds,
    text,
    overlayApplied: false,
  };
}

export async function burnVideoSubtitles(options: ProjectOrFileOptions & {
  subtitlePath: string;
  outputPath?: string;
}): Promise<VideoSubtitleBurnResult> {
  const sourcePath = assertSourcePath(await resolveSourcePath(options));
  const subtitlePath = options.subtitlePath;
  const outputPath = options.outputPath ?? buildDefaultOutputPath(sourcePath, 'subtitled');
  await mkdir(dirname(outputPath), { recursive: true });

  const subtitlesAvailable = await ffmpegSupportsFilter('subtitles');
  if (subtitlesAvailable) {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', sourcePath,
      '-vf', `subtitles='${escapeSubtitleFilterPath(subtitlePath)}'`,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '192k',
      outputPath,
    ], { encoding: 'utf-8' });
  } else {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', sourcePath,
      '-i', subtitlePath,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-c:s', 'mov_text',
      outputPath,
    ], { encoding: 'utf-8' });
  }

  const metadata = await probeMedia(outputPath);
  return {
    ...(options.projectSlug ? { projectSlug: options.projectSlug } : {}),
    sourcePath,
    subtitlePath,
    outputPath,
    burnedIn: subtitlesAvailable,
    ...metadata,
  };
}
