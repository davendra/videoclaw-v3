import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { probeMedia, resolveProjectFinalPath } from './final-media.js';

const execFileAsync = promisify(execFile);

export interface VideoFinalVerificationReport {
  projectSlug?: string;
  sourcePath: string;
  durationSeconds?: number;
  sizeBytes?: number;
  videoCodec?: string;
  width?: number;
  height?: number;
  frameRate?: string;
  audioPresent: boolean;
  audioCodec?: string;
  framePath: string;
}

async function extractMidpointFrame(sourcePath: string, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const metadata = await probeMedia(sourcePath);
  const midpoint = Math.max(0, (metadata.durationSeconds ?? 0) / 2);
  const framePath = join(outputDir, 'post-check-frame.jpg');

  await execFileAsync('ffmpeg', [
    '-y',
    '-ss', String(midpoint),
    '-i', sourcePath,
    '-frames:v', '1',
    '-update', '1',
    framePath,
  ], { encoding: 'utf-8' });

  return framePath;
}

export async function verifyFinalOutput(options: {
  projectSlug?: string;
  filePath?: string;
  root?: string;
  outputDir?: string;
}): Promise<VideoFinalVerificationReport> {
  const root = options.root ?? process.cwd();
  const sourcePath = options.filePath
    ?? (options.projectSlug ? await resolveProjectFinalPath(options.projectSlug, root) : undefined);

  if (!sourcePath) {
    throw new Error('verifyFinalOutput requires either projectSlug or filePath');
  }

  const outputDir = options.outputDir ?? join(dirname(sourcePath), 'verification');
  const metadata = await probeMedia(sourcePath);
  const framePath = await extractMidpointFrame(sourcePath, outputDir);

  return {
    ...(options.projectSlug ? { projectSlug: options.projectSlug } : {}),
    sourcePath,
    ...metadata,
    framePath,
  };
}
