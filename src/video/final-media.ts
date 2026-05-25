import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ensureProjectWorkspace } from './workspace.js';

const execFileAsync = promisify(execFile);

export interface VideoMediaProbe {
  durationSeconds?: number;
  sizeBytes?: number;
  videoCodec?: string;
  width?: number;
  height?: number;
  frameRate?: string;
  audioPresent: boolean;
  audioCodec?: string;
}

async function resolveFromFinalDirectory(projectSlug: string, root: string): Promise<string | null> {
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const finalDir = join(workspace.projectDir, 'final');
  if (!existsSync(finalDir)) {
    return null;
  }

  const entries = await readdir(finalDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mp4'))
    .map((entry) => join(finalDir, entry.name))
    .sort();
  const preferred = files.find((file) => file.endsWith('narrated-fixed.mp4')) ?? files[0];
  return preferred ?? null;
}

async function resolveFromPublishReport(projectSlug: string, root: string): Promise<string | null> {
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const publishReportPath = join(workspace.artifactsDir, 'publish-report.json');
  if (!existsSync(publishReportPath)) {
    return null;
  }
  const publishReport = JSON.parse(await readFile(publishReportPath, 'utf-8')) as {
    finalOutputPath?: string;
  };
  const finalOutputPath = publishReport.finalOutputPath?.trim();
  if (!finalOutputPath) {
    return null;
  }
  if (!existsSync(finalOutputPath)) {
    throw new Error(`Publish report final output is missing: ${finalOutputPath}`);
  }
  return finalOutputPath;
}

export async function resolveProjectFinalPath(projectSlug: string, root: string): Promise<string> {
  const resolvedFromFinalDir = await resolveFromFinalDirectory(projectSlug, root);
  if (resolvedFromFinalDir) {
    return resolvedFromFinalDir;
  }
  const resolvedFromPublishReport = await resolveFromPublishReport(projectSlug, root);
  if (resolvedFromPublishReport) {
    return resolvedFromPublishReport;
  }
  throw new Error(`No final output found for project ${projectSlug}. Expected project final/ mp4 or artifacts/publish-report.json.finalOutputPath.`);
}

export async function probeMedia(path: string): Promise<VideoMediaProbe> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_streams',
    '-show_format',
    '-of', 'json',
    path,
  ], { encoding: 'utf-8' });

  const payload = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
    }>;
    format?: {
      duration?: string;
      size?: string;
    };
  };

  const video = payload.streams?.find((stream) => stream.codec_type === 'video');
  const audio = payload.streams?.find((stream) => stream.codec_type === 'audio');
  const durationSeconds = payload.format?.duration ? Number(payload.format.duration) : undefined;
  const sizeBytes = payload.format?.size ? Number(payload.format.size) : undefined;

  return {
    ...(Number.isFinite(durationSeconds) ? { durationSeconds } : {}),
    ...(Number.isFinite(sizeBytes) ? { sizeBytes } : {}),
    ...(video?.codec_name ? { videoCodec: video.codec_name } : {}),
    ...(typeof video?.width === 'number' ? { width: video.width } : {}),
    ...(typeof video?.height === 'number' ? { height: video.height } : {}),
    ...(video?.r_frame_rate ? { frameRate: video.r_frame_rate } : {}),
    audioPresent: Boolean(audio),
    ...(audio?.codec_name ? { audioCodec: audio.codec_name } : {}),
  };
}
