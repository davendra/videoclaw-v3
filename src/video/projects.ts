import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function isProjectSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

export async function listProjects(root = process.cwd()): Promise<string[]> {
  const projectsDir = join(resolve(root), 'projects');
  if (!existsSync(projectsDir)) return [];
  const entries = await readdir(projectsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => isProjectSlug(entry.name))
    .map((entry) => entry.name)
    .sort();
}
