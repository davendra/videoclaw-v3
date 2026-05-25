import { createInterface } from 'node:readline/promises';

const DEFAULT_BASE_URL = 'https://gobananasai.com/api';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export interface GoBananasCharacter {
  id: number;
  character_name: string;
  base_prompt: string;
  description?: string;
  reference_images?: unknown[];
  last_used_at?: string;
}

export interface CleanOptions {
  dryRun: boolean;
  ids: Set<number>;
  nameRegex: RegExp | null;
  bloated: boolean;
  maxPromptChars: number;
  yes: boolean;
  patchId: number | null;
  patchBasePrompt: string | null;
  baseUrl: string;
  apiKey: string;
}

const FIND_STOPWORDS = new Set([
  'the', 'and', 'but', 'for', 'with', 'about', 'from', 'into', 'onto',
  'this', 'that', 'these', 'those', 'what', 'when', 'where', 'which',
  'his', 'her', 'their', 'our', 'your', 'its',
  'has', 'have', 'had', 'was', 'were', 'are', 'is', 'be',
  'day', 'night', 'story', 'tale', 'storybook', 'adventure', 'scene',
  'little', 'big', 'small', 'tall', 'tiny', 'huge', 'pet',
  'japanese', 'chinese', 'korean', 'american', 'british',
  'cute', 'adorable', 'sweet', 'warm', 'cold', 'quiet', 'loud',
  'red', 'blue', 'green', 'yellow', 'brown', 'black', 'white', 'pink',
  'old', 'new', 'young', 'lonely', 'happy', 'sad', 'brave',
  'samurai', 'boy', 'girl', 'child', 'man', 'woman', 'bunny', 'rabbit',
  'dog', 'cat', 'fox', 'bear', 'horse', 'bird',
  'named', 'called', 'known',
  'meets', 'meet', 'finds', 'find', 'discover', 'discovers', 'travel',
  'back', 'time', 'place', 'world', 'house', 'home',
  'scroll', 'sword', 'magic', 'forest', 'village', 'castle',
  'courage', 'help', 'learn', 'teach',
]);
const ARCHETYPE_CONFLICTS = [
  'android', 'robot', 'deity', 'vishnu', 'saraswati', 'ganesha',
  'lakshmi', 'shiva', 'tech guru', 'mascot', 'moon-headed',
  'data pipeline', 'creature', 'monster', 'ghost',
];

function resolvedBaseUrl(): string {
  return process.env.GO_BANANAS_API_URL?.trim() || DEFAULT_BASE_URL;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    'X-API-Key': apiKey,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': BROWSER_UA,
  };
}

export async function listAllCharacters(
  apiKey: string,
  url: string = resolvedBaseUrl(),
): Promise<GoBananasCharacter[]> {
  const all: GoBananasCharacter[] = [];
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const resp = await fetch(`${url}/characters?offset=${offset}`, { headers: authHeaders(apiKey) });
    if (!resp.ok) {
      throw new Error(`GET /characters failed: ${resp.status} ${await resp.text().then((t) => t.slice(0, 200))}`);
    }
    const data = await resp.json() as {
      data?: GoBananasCharacter[];
      characters?: GoBananasCharacter[];
      pagination?: { hasMore?: boolean; offset?: number; limit?: number };
    } | GoBananasCharacter[];

    const pageRows: GoBananasCharacter[] = Array.isArray(data)
      ? data
      : (data.characters ?? data.data ?? []);
    if (pageRows.length === 0) break;
    all.push(...pageRows);

    const meta = !Array.isArray(data) ? data.pagination : undefined;
    if (!meta?.hasMore) break;
    offset = (meta.offset ?? offset) + (meta.limit ?? pageRows.length);
  }
  return all;
}

export function extractLibraryIntentQueries(userIntent: string): string[] {
  const words: string[] = [];
  for (const raw of userIntent.split(/\s+/)) {
    const stripped = raw.trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
    if (!stripped || !stripped[0]?.match(/[A-Z]/)) continue;
    const token = stripped.toLowerCase().replace(/[^a-z]/g, '');
    if (token.length < 3 || FIND_STOPWORDS.has(token)) continue;
    words.push(token);
  }

  const seen = new Set<string>();
  const queries: string[] = [];
  for (const word of words) {
    if (seen.has(word)) continue;
    seen.add(word);
    queries.push(word);
  }
  return queries;
}

export async function searchCharactersByExactName(
  query: string,
  apiKey: string,
  url: string = resolvedBaseUrl(),
): Promise<GoBananasCharacter[]> {
  const resp = await fetch(`${url}/characters?search=${encodeURIComponent(query)}&exact=true`, {
    headers: authHeaders(apiKey),
  });
  if (!resp.ok) {
    throw new Error(`GET /characters?search=${query} failed: ${resp.status} ${await resp.text().then((t) => t.slice(0, 200))}`);
  }
  const data = await resp.json() as {
    data?: GoBananasCharacter[];
    characters?: GoBananasCharacter[];
  } | GoBananasCharacter[];
  return Array.isArray(data) ? data : (data.characters ?? data.data ?? []);
}

function nameTokens(character: GoBananasCharacter): string[] {
  return String(character.character_name ?? '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function candidateArchetypeClashes(character: GoBananasCharacter, userIntent: string): boolean {
  const blob = `${character.character_name ?? ''} ${character.base_prompt ?? ''} ${character.description ?? ''}`.toLowerCase();
  const normalizedIntent = userIntent.toLowerCase();
  return ARCHETYPE_CONFLICTS.some((marker) => blob.includes(marker) && !normalizedIntent.includes(marker));
}

export async function findLibraryCharactersByIntent(
  userIntent: string,
  apiKey: string,
  url: string = resolvedBaseUrl(),
): Promise<GoBananasCharacter[]> {
  const queries = extractLibraryIntentQueries(userIntent);
  const results = new Map<number, GoBananasCharacter>();

  for (const query of queries) {
    const searchHits = await searchCharactersByExactName(query, apiKey, url);
    const compatibleHits = searchHits
      .filter((character) => nameTokens(character).includes(query))
      .filter((character) => !candidateArchetypeClashes(character, userIntent))
      .sort((left, right) => {
        const leftFirstToken = nameTokens(left)[0] === query ? 1 : 0;
        const rightFirstToken = nameTokens(right)[0] === query ? 1 : 0;
        return rightFirstToken - leftFirstToken;
      });

    const picked = compatibleHits[0];
    if (!picked || results.has(picked.id)) continue;
    results.set(picked.id, picked);
  }

  return [...results.values()];
}

export async function deleteCharacter(
  id: number,
  apiKey: string,
  url: string = resolvedBaseUrl(),
): Promise<{ deleted: boolean }> {
  const resp = await fetch(`${url}/characters/${id}`, {
    method: 'DELETE',
    headers: authHeaders(apiKey),
  });
  if (resp.status === 404) return { deleted: false };
  if (!resp.ok) {
    throw new Error(`DELETE /characters/${id} failed: ${resp.status} ${await resp.text().then((t) => t.slice(0, 200))}`);
  }
  const body = await resp.json() as { data?: { deleted?: boolean }; deleted?: boolean };
  return { deleted: Boolean(body?.data?.deleted ?? body?.deleted ?? false) };
}

export async function patchCharacter(
  id: number,
  updates: Partial<Pick<GoBananasCharacter, 'base_prompt' | 'description'>>,
  apiKey: string,
  url: string = resolvedBaseUrl(),
): Promise<GoBananasCharacter> {
  const resp = await fetch(`${url}/characters/${id}`, {
    method: 'PATCH',
    headers: authHeaders(apiKey),
    body: JSON.stringify(updates),
  });
  if (!resp.ok) {
    throw new Error(`PATCH /characters/${id} failed: ${resp.status} ${await resp.text().then((t) => t.slice(0, 200))}`);
  }
  const body = await resp.json() as { data?: GoBananasCharacter } | GoBananasCharacter;
  return (body as { data?: GoBananasCharacter }).data ?? (body as GoBananasCharacter);
}

export function selectCandidates(
  all: GoBananasCharacter[],
  opts: Pick<CleanOptions, 'ids' | 'nameRegex' | 'bloated' | 'maxPromptChars'>,
): GoBananasCharacter[] {
  if (opts.ids.size === 0 && !opts.nameRegex && !opts.bloated) return [];
  const out: GoBananasCharacter[] = [];
  for (const character of all) {
    const basePrompt = character.base_prompt ?? '';
    const name = character.character_name ?? '';
    if (opts.ids.has(character.id)) { out.push(character); continue; }
    if (opts.nameRegex && opts.nameRegex.test(name)) { out.push(character); continue; }
    if (opts.bloated && basePrompt.length > opts.maxPromptChars) { out.push(character); continue; }
  }
  return out;
}

export function formatRow(character: GoBananasCharacter): string {
  const basePrompt = (character.base_prompt ?? '').replace(/\s+/g, ' ').slice(0, 60);
  const length = (character.base_prompt ?? '').length;
  return `  id=${String(character.id).padStart(4)}  ${String(character.character_name ?? '?').padEnd(32).slice(0, 32)}  ${String(length).padStart(4)}ch  "${basePrompt}${length > 60 ? '…' : ''}"`;
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

export async function runLibraryClean(opts: CleanOptions): Promise<number> {
  if (!opts.apiKey) {
    console.error('GO_BANANAS_API_KEY is required (env var or pass via shell).');
    return 2;
  }

  if (opts.patchId !== null) {
    if (!opts.patchBasePrompt || opts.patchBasePrompt.length === 0) {
      console.error('--patch requires --base-prompt');
      return 2;
    }
    console.error(`PATCH /characters/${opts.patchId} base_prompt (${opts.patchBasePrompt.length} chars)`);
    if (opts.dryRun) {
      console.log('(dry-run) — no request sent');
      return 0;
    }
    const updated = await patchCharacter(opts.patchId, { base_prompt: opts.patchBasePrompt }, opts.apiKey, opts.baseUrl);
    console.log(`  ok — ${updated.character_name ?? opts.patchId}`);
    return 0;
  }

  const all = await listAllCharacters(opts.apiKey, opts.baseUrl);
  const candidates = selectCandidates(all, opts);

  if (candidates.length === 0) {
    const filterDesc: string[] = [];
    if (opts.ids.size > 0) filterDesc.push(`${opts.ids.size} id(s)`);
    if (opts.nameRegex) filterDesc.push(`name=~${opts.nameRegex.source}`);
    if (opts.bloated) filterDesc.push(`bloated (>${opts.maxPromptChars}ch)`);
    if (filterDesc.length === 0) {
      console.log('Pass at least one selector: --ids, --name-regex, or --bloated. (No selector = no action.)');
    } else {
      console.log(`No candidates matched (filters: ${filterDesc.join(', ')}). Scanned ${all.length} character(s).`);
    }
    return 0;
  }

  console.log(`\nCandidates (${candidates.length}):`);
  for (const candidate of candidates) console.log(formatRow(candidate));

  if (opts.dryRun) {
    console.log('\n(dry-run) — pass --yes to delete, or rerun without --dry-run for interactive prompt.');
    return 0;
  }

  if (!opts.yes) {
    const go = await confirm(`\nDELETE all ${candidates.length} listed character(s)? [y/N] `);
    if (!go) {
      console.log('Aborted.');
      return 0;
    }
  }

  let deleted = 0;
  let missing = 0;
  for (const candidate of candidates) {
    try {
      const result = await deleteCharacter(candidate.id, opts.apiKey, opts.baseUrl);
      if (result.deleted) {
        deleted += 1;
        console.log(`  ✓ deleted id=${candidate.id} (${candidate.character_name ?? '?'})`);
      } else {
        missing += 1;
        console.log(`  — id=${candidate.id} already missing`);
      }
    } catch (error) {
      console.error(`  ✗ id=${candidate.id}: ${(error as Error).message}`);
    }
  }

  console.log(`\nDone. deleted=${deleted}  missing=${missing}  of ${candidates.length}`);
  return 0;
}

export function parseLibraryCleanArgs(rest: string[]): CleanOptions {
  const opts: CleanOptions = {
    dryRun: false,
    ids: new Set<number>(),
    nameRegex: null,
    bloated: false,
    maxPromptChars: 400,
    yes: false,
    patchId: null,
    patchBasePrompt: null,
    baseUrl: resolvedBaseUrl(),
    apiKey: process.env.GO_BANANAS_API_KEY ?? '',
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    switch (arg) {
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--yes':
      case '-y':
        opts.yes = true;
        break;
      case '--bloated':
        opts.bloated = true;
        break;
      case '--max-prompt-chars':
        opts.maxPromptChars = Math.max(1, parseInt(rest[++i] ?? '400', 10));
        break;
      case '--ids': {
        const raw = rest[++i] ?? '';
        for (const part of raw.split(',').map((value) => value.trim()).filter(Boolean)) {
          const id = parseInt(part, 10);
          if (!Number.isNaN(id)) opts.ids.add(id);
        }
        break;
      }
      case '--name-regex': {
        const src = rest[++i] ?? '';
        if (src) opts.nameRegex = new RegExp(src, 'i');
        break;
      }
      case '--patch':
        opts.patchId = parseInt(rest[++i] ?? '', 10) || null;
        break;
      case '--base-prompt':
        opts.patchBasePrompt = rest[++i] ?? null;
        break;
      case '--api-url':
        opts.baseUrl = rest[++i] ?? opts.baseUrl;
        break;
      default:
        throw new Error(`Unknown video library option: ${arg}`);
    }
  }

  return opts;
}

export const LIBRARY_HELP = `vclaw video library - Go Bananas character library hygiene

Usage:
  vclaw video library find --intent "<text>" [--api-url <url>]
  vclaw video library clean [options]
  vclaw video library clean --patch <id> --base-prompt "<text>" [--dry-run]

Options:
  --ids 244,141           Target specific character IDs
  --name-regex PATTERN    Match character_name (case-insensitive)
  --bloated               Include chars whose base_prompt > 400 chars
  --max-prompt-chars N    Override the bloated threshold (default 400)
  --dry-run               List candidates, do not delete
  --yes / -y              Skip confirmation prompt
  --patch <id>            Update a single character (requires --base-prompt)
  --base-prompt "<text>"  New base_prompt for the --patch target
  --api-url <url>         Override GO_BANANAS_API_URL (default https://gobananasai.com/api)

Env:
  GO_BANANAS_API_KEY      Required. X-API-Key sent with every request.
`;
