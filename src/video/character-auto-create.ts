import { addCharacterProfile } from './characters.js';
import { searchCharactersByExactName } from './library-clean.js';
import { ensureProjectWorkspace } from './workspace.js';

const DEFAULT_BASE_URL = 'https://gobananasai.com/api';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export interface CharacterAutoCreateInput {
  name: string;
  description: string;
  style?: string;
}

export interface CharacterAutoCreateResult {
  characterId: number;
  imageUrl: string;
  created: boolean;
  importedToProject: boolean;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': BROWSER_UA,
  };
}

function buildPortraitPrompt(input: CharacterAutoCreateInput): string {
  const stylePrefix = input.style?.trim() || 'photorealistic cinematic portrait';
  return `${stylePrefix} character portrait of ${input.description.trim()}, front-facing, neutral background, full-body composition, high detail, consistent character design. No text, no watermarks.`;
}

function buildBasePrompt(input: CharacterAutoCreateInput): string {
  return input.style?.trim()
    ? `${input.description.trim()}. Style: ${input.style.trim()}.`
    : input.description.trim();
}

async function generatePortraitUrl(
  input: CharacterAutoCreateInput,
  apiKey: string,
  apiUrl: string,
): Promise<string> {
  const response = await fetch(`${apiUrl}/images`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      prompt: buildPortraitPrompt(input),
      aspect_ratio: '1:1',
      model_id: 'gemini-pro-image',
      enhance_prompt: false,
      negative_prompt: 'text, watermark, logo, title, blurry, deformed',
    }),
  });
  if (!response.ok) {
    throw new Error(`POST /images failed: ${response.status} ${await response.text().then((text) => text.slice(0, 200))}`);
  }
  const payload = await response.json() as {
    url?: string;
    image_url?: string;
    data?: { url?: string; images?: Array<{ full_url?: string; url?: string }> };
    images?: Array<{ full_url?: string; url?: string }>;
  };
  const imageUrl = payload.url
    ?? payload.image_url
    ?? payload.data?.url
    ?? payload.data?.images?.[0]?.full_url
    ?? payload.data?.images?.[0]?.url
    ?? payload.images?.[0]?.full_url
    ?? payload.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error('POST /images succeeded but returned no image URL');
  }
  return imageUrl;
}

async function uploadForEditing(
  imageUrl: string,
  apiKey: string,
  apiUrl: string,
): Promise<number> {
  const response = await fetch(`${apiUrl}/upload-for-editing`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ image_url: imageUrl }),
  });
  if (!response.ok) {
    throw new Error(`POST /upload-for-editing failed: ${response.status} ${await response.text().then((text) => text.slice(0, 200))}`);
  }
  const payload = await response.json() as {
    image_id?: number;
    imageId?: number;
  };
  const imageId = payload.image_id ?? payload.imageId;
  if (!imageId) {
    throw new Error('POST /upload-for-editing succeeded but returned no image_id');
  }
  return imageId;
}

async function createCharacter(
  input: CharacterAutoCreateInput,
  imageId: number,
  apiKey: string,
  apiUrl: string,
): Promise<number> {
  const response = await fetch(`${apiUrl}/characters`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      character_name: input.name,
      base_prompt: buildBasePrompt(input),
      description: input.description,
      reference_image_ids: [imageId],
    }),
  });
  if (!response.ok) {
    throw new Error(`POST /characters failed: ${response.status} ${await response.text().then((text) => text.slice(0, 200))}`);
  }
  const payload = await response.json() as {
    id?: number;
    character_id?: number;
    data?: { id?: number; character_id?: number };
  };
  const characterId = payload.data?.id ?? payload.data?.character_id ?? payload.id ?? payload.character_id;
  if (!characterId) {
    throw new Error('POST /characters succeeded but returned no character id');
  }
  return characterId;
}

export async function autoCreateCharacters(inputs: CharacterAutoCreateInput[], options?: {
  projectSlug?: string;
  root?: string;
  apiKey?: string;
  apiUrl?: string;
  dryRun?: boolean;
}): Promise<Record<string, CharacterAutoCreateResult>> {
  const apiKey = options?.apiKey ?? process.env.GO_BANANAS_API_KEY ?? '';
  if (!apiKey) {
    throw new Error('GO_BANANAS_API_KEY is required for character auto-create');
  }
  const apiUrl = (options?.apiUrl ?? process.env.GO_BANANAS_API_URL ?? DEFAULT_BASE_URL).trim();
  const workspace = options?.projectSlug
    ? await ensureProjectWorkspace(options.projectSlug, options.root ?? process.cwd())
    : null;
  const results: Record<string, CharacterAutoCreateResult> = {};

  for (const input of inputs) {
    const name = input.name.trim();
    const description = input.description.trim();
    if (!name || !description) {
      continue;
    }

    const existing = (await searchCharactersByExactName(name, apiKey, apiUrl))
      .find((character) => String(character.character_name ?? '').trim().toLowerCase() === name.toLowerCase());

    if (existing) {
      const characterId = existing.id;
      const imageUrl = String(existing.description ?? existing.base_prompt ?? '');
      if (workspace) {
        await addCharacterProfile(workspace, {
          name,
          goBananasId: characterId,
          description,
          referenceAssets: [`gobananas://character/${characterId}`],
          ...(input.style ? { notes: [`style=${input.style}`] } : {}),
        });
      }
      results[name] = {
        characterId,
        imageUrl: '',
        created: false,
        importedToProject: Boolean(workspace),
      };
      continue;
    }

    if (options?.dryRun) {
      results[name] = {
        characterId: -1,
        imageUrl: '',
        created: true,
        importedToProject: false,
      };
      continue;
    }

    const imageUrl = await generatePortraitUrl(input, apiKey, apiUrl);
    const imageId = await uploadForEditing(imageUrl, apiKey, apiUrl);
    const characterId = await createCharacter(input, imageId, apiKey, apiUrl);
    if (workspace) {
      await addCharacterProfile(workspace, {
        name,
        goBananasId: characterId,
        description,
        referenceAssets: [`gobananas://character/${characterId}`],
        ...(input.style ? { notes: [`style=${input.style}`] } : {}),
      });
    }
    results[name] = {
      characterId,
      imageUrl,
      created: true,
      importedToProject: Boolean(workspace),
    };
  }

  return results;
}
