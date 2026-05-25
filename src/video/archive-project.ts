import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveProjectWorkspace } from './workspace.js';

const execFileAsync = promisify(execFile);

function timestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

export interface VideoArchiveProjectResult {
  projectSlug: string;
  projectDir: string;
  archivePath: string;
  cleanedUp: boolean;
}

export async function archiveProject(options: {
  projectSlug: string;
  root?: string;
  archiveDir?: string;
  cleanup?: boolean;
  now?: Date;
}): Promise<VideoArchiveProjectResult> {
  const root = options.root ?? process.cwd();
  const workspace = resolveProjectWorkspace(options.projectSlug, root);
  if (!existsSync(workspace.projectDir)) {
    throw new Error(`Project directory not found for ${options.projectSlug}`);
  }

  const archiveDir = options.archiveDir ?? join(workspace.root, 'archives');
  await mkdir(archiveDir, { recursive: true });

  const now = options.now ?? new Date();
  const archivePath = join(archiveDir, `${options.projectSlug}-${timestamp(now)}.tar.gz`);

  await execFileAsync(
    'tar',
    ['-czf', archivePath, '-C', join(workspace.root, 'projects'), options.projectSlug],
    { encoding: 'utf-8' },
  );

  if (options.cleanup) {
    await rm(workspace.projectDir, { recursive: true, force: true });
  }

  return {
    projectSlug: options.projectSlug,
    projectDir: workspace.projectDir,
    archivePath,
    cleanedUp: Boolean(options.cleanup),
  };
}
