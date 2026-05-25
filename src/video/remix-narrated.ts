import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ensureProjectWorkspace } from './workspace.js';

const execFileAsync = promisify(execFile);

export interface NarratedRemixResult {
  projectSlug: string;
  projectDir: string;
  inputFiles: string[];
  outputPath: string;
  durationSeconds?: number;
}

async function readNarratedClipPaths(videosDir: string): Promise<string[]> {
  if (!existsSync(videosDir)) {
    throw new Error(`No videos directory found at ${videosDir}`);
  }
  const entries = await readdir(videosDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.includes('narrated') && entry.name.endsWith('.mp4'))
    .map((entry) => join(videosDir, entry.name))
    .sort();
}

async function probeDurationSeconds(path: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path,
    ], { encoding: 'utf-8' });
    const parsed = Number(stdout.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function remixNarratedProject(
  projectSlug: string,
  options: {
    root?: string;
    outputPath?: string;
  } = {},
): Promise<NarratedRemixResult> {
  const root = options.root ?? process.cwd();
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const videosDir = join(workspace.projectDir, 'videos');
  const finalDir = join(workspace.projectDir, 'final');
  const inputFiles = await readNarratedClipPaths(videosDir);
  if (inputFiles.length === 0) {
    throw new Error(`No narrated mp4 clips found in ${videosDir}`);
  }

  const outputPath = options.outputPath ?? join(finalDir, 'narrated-fixed.mp4');
  await mkdir(finalDir, { recursive: true });
  const scratchDir = await mkdtemp(join(tmpdir(), 'vclaw-remix-narrated-'));
  const concatPath = join(scratchDir, 'concat.txt');

  try {
    const concatContent = inputFiles
      .map((path) => `file '${path.replaceAll("'", "'\\''")}'`)
      .join('\n');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(concatPath, `${concatContent}\n`));

    await execFileAsync('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatPath,
      '-c', 'copy',
      outputPath,
    ], { encoding: 'utf-8' });

    const durationSeconds = await probeDurationSeconds(outputPath);
    return {
      projectSlug,
      projectDir: workspace.projectDir,
      inputFiles,
      outputPath,
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    };
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}
