import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { resolveProjectWorkspace } from './workspace.js';
import { writeTextFileAtomic } from './atomic-write.js';
import type { ReferenceSheetsArtifact } from './types.js';
import { validateArtifact } from './reference-sheets.js';

export function referenceSheetsPathFor(root: string, slug: string): string {
  return join(resolveProjectWorkspace(slug, root).projectDir, 'references', 'reference-sheets.json');
}

export async function readReferenceSheetsArtifact(
  root: string,
  slug: string,
): Promise<ReferenceSheetsArtifact> {
  const path = referenceSheetsPathFor(root, slug);
  if (!existsSync(path)) {
    return { schemaVersion: 1, sheets: [] };
  }
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as ReferenceSheetsArtifact;
  const result = validateArtifact(parsed);
  if (!result.ok) {
    throw new Error(
      `invalid reference-sheets artifact at ${path}: ${result.errors.join(', ')}`,
    );
  }
  return parsed;
}

export async function writeReferenceSheetsArtifact(
  root: string,
  slug: string,
  artifact: ReferenceSheetsArtifact,
): Promise<void> {
  const path = referenceSheetsPathFor(root, slug);
  await mkdir(dirname(path), { recursive: true });
  await writeTextFileAtomic(path, JSON.stringify(artifact, null, 2) + '\n');
}
