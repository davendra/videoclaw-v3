import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { resolveProjectWorkspace } from './workspace.js';
import { writeTextFileAtomic } from './atomic-write.js';
import type { SceneCandidatesArtifact } from './types.js';

export function sceneCandidatesPathFor(root: string, slug: string): string {
  return join(
    resolveProjectWorkspace(slug, root).projectDir,
    'artifacts',
    'scene-candidates.json',
  );
}

export async function readSceneCandidatesArtifact(
  root: string,
  slug: string,
): Promise<SceneCandidatesArtifact> {
  const path = sceneCandidatesPathFor(root, slug);
  if (!existsSync(path)) {
    return { schemaVersion: 1, scenes: [] };
  }
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as SceneCandidatesArtifact;
}

export async function writeSceneCandidatesArtifact(
  root: string,
  slug: string,
  artifact: SceneCandidatesArtifact,
): Promise<void> {
  const path = sceneCandidatesPathFor(root, slug);
  await mkdir(dirname(path), { recursive: true });
  await writeTextFileAtomic(path, JSON.stringify(artifact, null, 2) + '\n');
}

export async function updateSceneCandidatesArtifact<T>(
  root: string,
  slug: string,
  updater: (artifact: SceneCandidatesArtifact) => Promise<{
    artifact: SceneCandidatesArtifact;
    result: T;
  }> | {
    artifact: SceneCandidatesArtifact;
    result: T;
  },
): Promise<T> {
  const path = sceneCandidatesPathFor(root, slug);
  await mkdir(dirname(path), { recursive: true });
  const release = await acquireSceneCandidatesLock(path);
  try {
    const current = await readSceneCandidatesArtifact(root, slug);
    const updated = await updater(current);
    await writeTextFileAtomic(path, JSON.stringify(updated.artifact, null, 2) + '\n');
    return updated.result;
  } finally {
    await release();
  }
}

async function acquireSceneCandidatesLock(path: string): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }));
      return async () => {
        await handle.close();
        await rm(lockPath, { force: true });
      };
    } catch (error) {
      const code = error instanceof Error && 'code' in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
      if (code !== 'EEXIST') throw error;
      await removeStaleLock(lockPath);
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for scene-candidates lock: ${lockPath}`);
      }
      await sleep(25);
    }
  }
}

async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs > 30_000) {
      await rm(lockPath, { force: true });
    }
  } catch (error) {
    const code = error instanceof Error && 'code' in error
      ? (error as NodeJS.ErrnoException).code
      : undefined;
    if (code !== 'ENOENT') throw error;
  }
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
