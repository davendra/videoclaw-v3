import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { artifactPathFor } from './artifact-store.js';
import { listCharacterProfiles } from './characters.js';
import { resolveProjectWorkspace } from './workspace.js';
import type { CharacterConsistencyReport } from './types.js';

export async function buildCharacterConsistencyReport(
  slug: string,
  root = process.cwd(),
): Promise<CharacterConsistencyReport> {
  const workspace = resolveProjectWorkspace(slug, root);
  const storyboardPath = artifactPathFor(workspace, 'storyboard');
  if (!existsSync(storyboardPath)) {
    return {
      slug,
      ok: true,
      referencedCharacters: [],
      missingProfiles: [],
      missingReferenceAssets: [],
      issues: [],
    };
  }

  const storyboard = JSON.parse(await readFile(storyboardPath, 'utf-8')) as {
    scenes?: Array<{ characters?: string[] }>;
  };
  const referencedCharacters = [
    ...new Set(
      (storyboard.scenes ?? [])
        .flatMap((scene) => scene.characters ?? [])
        .map((name) => String(name).trim())
        .filter(Boolean),
    ),
  ].sort();

  if (referencedCharacters.length === 0) {
    return {
      slug,
      ok: true,
      referencedCharacters: [],
      missingProfiles: [],
      missingReferenceAssets: [],
      issues: [],
    };
  }

  const profiles = await listCharacterProfiles(workspace);
  const profileMap = new Map(
    profiles.flatMap((profile) => [
      [profile.name.trim().toLowerCase(), profile] as const,
      [profile.id.trim().toLowerCase(), profile] as const,
    ]),
  );

  const missingProfiles: string[] = [];
  const missingReferenceAssets: string[] = [];
  for (const name of referencedCharacters) {
    const profile = profileMap.get(name.toLowerCase());
    if (!profile) {
      missingProfiles.push(name);
      continue;
    }
    if (!profile.referenceAssets || profile.referenceAssets.length === 0) {
      missingReferenceAssets.push(name);
    }
  }

  const issues: string[] = [];
  if (missingProfiles.length > 0) {
    issues.push(`Missing character profiles: ${missingProfiles.join(', ')}`);
  }
  if (missingReferenceAssets.length > 0) {
    issues.push(`Characters missing reference assets: ${missingReferenceAssets.join(', ')}`);
  }

  return {
    slug,
    ok: issues.length === 0,
    referencedCharacters,
    missingProfiles,
    missingReferenceAssets,
    issues,
  };
}
