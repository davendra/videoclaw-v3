import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { VideoProjectWorkspace } from './workspace.js';

export interface CharacterProfile {
  id: string;
  name: string;
  goBananasId?: number;
  description?: string;
  referenceAssets: string[];
  notes?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CharacterProfileStore {
  characters: CharacterProfile[];
}

async function readStore(workspace: VideoProjectWorkspace): Promise<CharacterProfileStore> {
  if (!existsSync(workspace.charactersPath)) {
    return { characters: [] };
  }
  return JSON.parse(await readFile(workspace.charactersPath, 'utf-8')) as CharacterProfileStore;
}

async function writeStore(workspace: VideoProjectWorkspace, store: CharacterProfileStore): Promise<void> {
  await writeFile(workspace.charactersPath, `${JSON.stringify(store, null, 2)}\n`);
}

function slugifyCharacter(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function addCharacterProfile(
  workspace: VideoProjectWorkspace,
  input: {
    name: string;
    goBananasId?: number;
    description?: string;
    referenceAssets?: string[];
    notes?: string[];
  },
): Promise<CharacterProfile> {
  const store = await readStore(workspace);
  const now = new Date().toISOString();
  const id = slugifyCharacter(input.name);
  const existing = store.characters.find((character) => character.id === id);
  const character: CharacterProfile = existing
    ? {
        ...existing,
        ...(input.goBananasId !== undefined ? { goBananasId: input.goBananasId } : {}),
        description: input.description ?? existing.description,
        referenceAssets: input.referenceAssets ?? existing.referenceAssets,
        notes: input.notes ?? existing.notes,
        updatedAt: now,
      }
    : {
        id,
        name: input.name,
        ...(input.goBananasId !== undefined ? { goBananasId: input.goBananasId } : {}),
        ...(input.description ? { description: input.description } : {}),
        referenceAssets: input.referenceAssets ?? [],
        ...(input.notes ? { notes: input.notes } : {}),
        createdAt: now,
        updatedAt: now,
      };

  const nextCharacters = store.characters.filter((candidate) => candidate.id !== id);
  nextCharacters.push(character);
  nextCharacters.sort((left, right) => left.name.localeCompare(right.name));
  await writeStore(workspace, { characters: nextCharacters });
  return character;
}

export async function listCharacterProfiles(
  workspace: VideoProjectWorkspace,
): Promise<CharacterProfile[]> {
  return (await readStore(workspace)).characters;
}

export async function readCharacterProfile(
  workspace: VideoProjectWorkspace,
  idOrName: string,
): Promise<CharacterProfile | null> {
  const normalized = slugifyCharacter(idOrName);
  const store = await readStore(workspace);
  return store.characters.find((character) => character.id === normalized || slugifyCharacter(character.name) === normalized) ?? null;
}
