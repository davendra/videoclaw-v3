import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveProjectWorkspace } from './workspace.js';

// xskill / NEX AI Asset Library client. Registers character reference images as
// managed "Asset" avatars and returns their Asset:// URIs — the official
// character-consistency mechanism for ark/seedance-2.0 (raw photoreal URLs in
// reference_images trip the "real person" content filter and don't lock
// identity; managed assets pass the filter and lock the character). The minted
// Asset:// URIs flow straight into native-seedance's referencePaths, which
// already routes Asset:// into reference_images. See the seedance-identity
// memory + docs/CLI_REFERENCE.md.

interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type FetchLike = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<FetchLikeResponse>;

export interface SeedanceAssetClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  /** Delay between asset sync-status polls (ms). Default 1500. */
  pollIntervalMs?: number;
  /** Max sync polls before giving up. Default 30 (~45s at the default interval). */
  maxSyncAttempts?: number;
  /** Injectable sleep so tests don't wait in real time. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RegisteredAsset {
  name: string;
  assetId: string;
  assetUri: string;
  intlAssetUri: string;
  syncStatus: string;
}

interface AssetListItem {
  asset_id?: string;
  asset_uri?: string;
  intl_asset_uri?: string;
  sync_status?: string;
}

const DEFAULT_BASE_URL = 'https://api.xskill.ai';

function resolved(options: SeedanceAssetClientOptions): {
  apiKey: string;
  baseUrl: string;
  fetchImpl: FetchLike;
  pollIntervalMs: number;
  maxSyncAttempts: number;
  sleep: (ms: number) => Promise<void>;
} {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new Error('Seedance Asset Library requires an API key (SUTUI_API_KEY).');
  }
  return {
    apiKey,
    baseUrl: (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    fetchImpl: options.fetchImpl ?? (fetch as unknown as FetchLike),
    pollIntervalMs: options.pollIntervalMs ?? 1500,
    maxSyncAttempts: options.maxSyncAttempts ?? 30,
    sleep: options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
  };
}

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    // Mirror the web app so the request is treated as a first-party call.
    Origin: 'https://www.xskill.ai',
    Referer: 'https://www.xskill.ai/',
  };
}

async function request(
  fetchImpl: FetchLike,
  method: string,
  url: string,
  apiKey: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method,
    headers: headers(apiKey),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`Asset Library ${method} ${url} failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function pick<T = unknown>(node: unknown, key: string): T | undefined {
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (key in record) return record[key] as T;
    if (record.data && typeof record.data === 'object' && key in (record.data as Record<string, unknown>)) {
      return (record.data as Record<string, unknown>)[key] as T;
    }
  }
  return undefined;
}

/** Find a group by exact name, or create it. Returns the group_id. */
export async function ensureAssetGroup(
  name: string,
  options: SeedanceAssetClientOptions,
): Promise<string> {
  const { apiKey, baseUrl, fetchImpl } = resolved(options);
  const listed = await request(fetchImpl, 'GET', `${baseUrl}/api/v3/assets/groups`, apiKey);
  const items = (pick<unknown[]>(listed, 'items') ?? pick<unknown[]>(listed, 'groups') ?? []) as Array<Record<string, unknown>>;
  const existing = items.find((group) => group.name === name);
  if (existing && typeof existing.group_id === 'string') {
    return existing.group_id;
  }
  const created = await request(fetchImpl, 'POST', `${baseUrl}/api/v3/assets/groups`, apiKey, {
    name,
    description: 'videoclaw character consistency assets',
  });
  const groupId = pick<string>(created, 'group_id');
  if (!groupId) {
    throw new Error(`Asset Library group create for "${name}" returned no group_id.`);
  }
  return groupId;
}

async function findAssetSync(
  fetchImpl: FetchLike,
  baseUrl: string,
  apiKey: string,
  assetId: string,
): Promise<AssetListItem | undefined> {
  const listed = await request(fetchImpl, 'GET', `${baseUrl}/api/v3/assets?page_size=600`, apiKey);
  const items = (pick<unknown[]>(listed, 'items') ?? []) as AssetListItem[];
  return items.find((item) => item.asset_id === assetId);
}

/**
 * Register a public image URL as an Image asset under the group, then poll until
 * it has synced to the international Ark profile (sync_status "active") — ark
 * rejects assets that are still "processing". Returns the Asset:// URI.
 */
export async function registerImageAsset(
  input: { groupId: string; name: string; imageUrl: string },
  options: SeedanceAssetClientOptions,
): Promise<RegisteredAsset> {
  const { apiKey, baseUrl, fetchImpl, pollIntervalMs, maxSyncAttempts, sleep } = resolved(options);
  const created = await request(fetchImpl, 'POST', `${baseUrl}/api/v3/assets`, apiKey, {
    group_id: input.groupId,
    name: input.name,
    asset_type: 'Image',
    image_url: input.imageUrl,
    media_url: input.imageUrl,
  });
  const assetId = pick<string>(created, 'asset_id');
  const assetUri = pick<string>(created, 'asset_uri');
  if (!assetId || !assetUri) {
    throw new Error(`Asset Library create for "${input.name}" returned no asset id/uri.`);
  }
  const intlAssetUri = pick<string>(created, 'intl_asset_uri') ?? assetUri.replace(/^Asset:\/\//, 'asset://');
  let syncStatus = pick<string>(created, 'sync_status') ?? 'processing';

  for (let attempt = 0; attempt < maxSyncAttempts && syncStatus !== 'active'; attempt += 1) {
    await sleep(pollIntervalMs);
    const found = await findAssetSync(fetchImpl, baseUrl, apiKey, assetId);
    if (found?.sync_status) syncStatus = found.sync_status;
  }
  if (syncStatus !== 'active') {
    throw new Error(`Asset "${input.name}" (${assetId}) did not reach sync_status "active" (last: ${syncStatus}).`);
  }
  return { name: input.name, assetId, assetUri, intlAssetUri, syncStatus };
}

/** One subject (character/product) entry in the seedance-assets.json artifact. */
export interface SeedanceAssetEntry {
  name: string;
  assetId: string;
  assetUri: string;
  intlAssetUri: string;
}

export interface SeedanceAssetsArtifact {
  schemaVersion: 1;
  projectSlug: string;
  groupName: string;
  generatedAt: string;
  assets: SeedanceAssetEntry[];
}

/**
 * Result of reading `artifacts/seedance-assets.json`. `assetUriByName` is the
 * lookup the execution layer wants: subject name -> Asset:// URI. `assets`
 * preserves the raw entries (assetId, intlAssetUri) for callers that need them.
 */
export interface SeedanceAssetsLookup {
  assets: SeedanceAssetEntry[];
  assetUriByName: Map<string, string>;
}

/**
 * Read `artifacts/seedance-assets.json` for a project. Returns an empty lookup
 * (no entries, empty map) when the artifact is absent — Seedance generations
 * degrade gracefully to description-only / unmanaged references rather than
 * failing. A present-but-malformed file is NOT swallowed: JSON.parse surfaces
 * the corruption, matching sibling readers like product-references.ts.
 */
export async function readSeedanceAssets(
  workspaceRoot: string,
  slug: string,
): Promise<SeedanceAssetsLookup> {
  const workspace = resolveProjectWorkspace(slug, workspaceRoot);
  const path = join(workspace.artifactsDir, 'seedance-assets.json');
  if (!existsSync(path)) {
    return { assets: [], assetUriByName: new Map() };
  }
  const parsed = JSON.parse(await readFile(path, 'utf-8')) as Partial<SeedanceAssetsArtifact>;
  const assets: SeedanceAssetEntry[] = Array.isArray(parsed.assets)
    ? parsed.assets.map((asset) => ({
        name: asset.name,
        assetId: asset.assetId,
        assetUri: asset.assetUri,
        intlAssetUri: asset.intlAssetUri,
      }))
    : [];
  const assetUriByName = new Map<string, string>();
  for (const asset of assets) {
    if (asset.name && asset.assetUri) {
      assetUriByName.set(asset.name, asset.assetUri);
    }
  }
  return { assets, assetUriByName };
}

/** High-level: ensure the group, register each character image, return the Asset:// URIs. */
export async function registerCharacterAssets(
  input: { groupName: string; characters: Array<{ name: string; imageUrl: string }> },
  options: SeedanceAssetClientOptions,
): Promise<RegisteredAsset[]> {
  const groupId = await ensureAssetGroup(input.groupName, options);
  const registered: RegisteredAsset[] = [];
  for (const character of input.characters) {
    registered.push(await registerImageAsset({ groupId, name: character.name, imageUrl: character.imageUrl }, options));
  }
  return registered;
}
