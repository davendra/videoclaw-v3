import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface VideoPlaybook {
  name: string;
  provider: 'veo' | 'seedance';
  useWhen: string[];
  promptFormula: string[];
  constraints: string[];
  adaptationChecklist: string[];
}

function playbooksDir(root = process.cwd()): string {
  return join(resolve(root), 'playbooks');
}

export async function listPlaybooks(root = process.cwd()): Promise<string[]> {
  const dir = playbooksDir(root);
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => entry.replace(/\.json$/, ''))
    .sort();
}

export async function readPlaybook(
  name: string,
  root = process.cwd(),
): Promise<VideoPlaybook | null> {
  const path = join(playbooksDir(root), `${name}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf-8')) as VideoPlaybook;
}
