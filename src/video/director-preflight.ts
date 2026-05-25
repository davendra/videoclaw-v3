import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { artifactPathFor } from './artifact-store.js';
import { writeArtifact } from './artifact-store.js';
import { listCharacterProfiles, type CharacterProfile } from './characters.js';
import { appendProjectEvent } from './events.js';
import { checkDialogueDurationFit } from './dialogue-fit.js';
import { readReferenceSheetsArtifact, referenceSheetsPathFor } from './reference-sheet-store.js';
import { findRoleCollisions, validateArtifact } from './reference-sheets.js';
import { runPromptQualityChecks } from './prompt-quality.js';
import { ensureProjectWorkspace } from './workspace.js';
import { resolveProjectWorkspace } from './workspace.js';
import type { ReferenceSheetsArtifact, VideoProductionMode } from './types.js';

export interface DirectorPreflightIssue {
  severity: 'error' | 'warn';
  code: string;
  scope: string;
  message: string;
  suggestion?: string;
}

export interface DirectorPreflightResult {
  pass: boolean;
  errors: DirectorPreflightIssue[];
  warnings: DirectorPreflightIssue[];
}

interface StoryboardArtifact {
  scenes?: Array<{
    sceneIndex?: number;
    description?: string;
    dialogue?: string;
    characters?: string[];
    durationSeconds?: number;
  }>;
}

export const CONTENT_FILTER_HAZARDS: Array<{
  pattern: RegExp;
  replacement: string;
  reason: string;
}> = [
  { pattern: /\bspectral\s+blade\b/gi, replacement: 'radiant staff of light', reason: 'weapon plus spectral phrasing trips provider policy' },
  { pattern: /\bspectral\s+katana\b/gi, replacement: 'radiant staff of light', reason: 'katana plus spectral phrasing trips provider policy' },
  { pattern: /\bkatana\s+clash(?:es|ed|ing)?\b/gi, replacement: 'energies intertwine', reason: 'weapon clash phrasing trips provider policy' },
  { pattern: /\bbody\s+(?:shatters?|breaks?\s+apart)\b/gi, replacement: 'body dissolves peacefully into starlight', reason: 'body disintegration phrasing trips provider policy' },
  { pattern: /\b(?:stab|slash|strike)(?:s|ed|ing)?\b/gi, replacement: 'deflect', reason: 'explicit combat verbs trip provider policy' },
  { pattern: /\btaser\b/gi, replacement: 'non-lethal pulse device', reason: 'weapon name trips provider policy' },
  { pattern: /\bfires\s+a\s+(?:gun|pistol|rifle|taser)\b/gi, replacement: 'aims a non-lethal pulse device', reason: 'firearm phrasing trips provider policy' },
];

const GENDER_CUES = {
  female: /\b(girl|woman|lady|female|actress|ballerina|sister|daughter|mother)\b/i,
  male: /\b(boy|man|guy|male|actor|brother|son|father)\b/i,
};

function inferGender(description?: string): 'female' | 'male' | 'unknown' {
  if (!description) return 'unknown';
  const stripped = description.replace(
    /\b(of|with|for|beside|to|from)\s+(a|an|the|his|her)?\s*\w*\s*(girl|woman|boy|man|lady|mother|father|sister|brother|daughter|son)\b/gi,
    '',
  );
  const female = GENDER_CUES.female.test(stripped);
  const male = GENDER_CUES.male.test(stripped);
  if (female && !male) return 'female';
  if (male && !female) return 'male';
  return 'unknown';
}

function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 4);
}

function sceneText(scene: NonNullable<StoryboardArtifact['scenes']>[number]): string {
  return [scene.description ?? '', scene.dialogue ?? ''].filter(Boolean).join(' ');
}

export function checkContentFilterHazards(storyboard: StoryboardArtifact): DirectorPreflightIssue[] {
  const issues: DirectorPreflightIssue[] = [];
  for (const scene of storyboard.scenes ?? []) {
    const text = sceneText(scene);
    for (const hazard of CONTENT_FILTER_HAZARDS) {
      const match = text.match(hazard.pattern);
      if (!match) continue;
      issues.push({
        severity: 'error',
        code: 'CONTENT_FILTER_HAZARD',
        scope: `scene:${scene.sceneIndex ?? 0}`,
        message: `Scene ${Number(scene.sceneIndex ?? 0) + 1} contains provider-risk wording: "${match[0]}".`,
        suggestion: `Rewrite with safer phrasing such as "${hazard.replacement}" because ${hazard.reason}.`,
      });
    }
  }
  return issues;
}

export function checkPronounConsistency(
  storyboard: StoryboardArtifact,
  profiles: CharacterProfile[],
): DirectorPreflightIssue[] {
  const issues: DirectorPreflightIssue[] = [];
  const genderByCharacter = new Map<string, 'female' | 'male' | 'unknown'>();
  for (const profile of profiles) {
    const gender = inferGender(profile.description);
    genderByCharacter.set(profile.name.toLowerCase(), gender);
    genderByCharacter.set(profile.id.toLowerCase(), gender);
  }

  for (const scene of storyboard.scenes ?? []) {
    const text = sceneText(scene).toLowerCase();
    for (const name of scene.characters ?? []) {
      const gender = genderByCharacter.get(name.toLowerCase()) ?? 'unknown';
      if (gender === 'unknown' || !text.includes(name.toLowerCase())) continue;
      const wrongPronouns = gender === 'female'
        ? text.match(/\b(he|his|him|himself)\b/gi)
        : text.match(/\b(she|her|hers|herself)\b/gi);
      if ((wrongPronouns?.length ?? 0) >= 2) {
        issues.push({
          severity: 'warn',
          code: 'PRONOUN_DRIFT',
          scope: `scene:${scene.sceneIndex ?? 0}`,
          message: `Scene ${Number(scene.sceneIndex ?? 0) + 1} contains pronoun drift for ${name}.`,
          suggestion: 'Normalize the scene wording before approval so character identity stays consistent.',
        });
      }
    }
  }
  return issues;
}

export function checkPromptQuality(storyboard: StoryboardArtifact): DirectorPreflightIssue[] {
  const issues: DirectorPreflightIssue[] = [];
  const scenes = storyboard.scenes ?? [];
  for (const [index, scene] of scenes.entries()) {
    const prompt = sceneText(scene);
    if (!prompt.trim()) continue;
    const promptIssues = runPromptQualityChecks(prompt);
    for (const promptIssue of promptIssues) {
      issues.push({
        severity: promptIssue.severity,
        code: promptIssue.code,
        scope: `scene:${scene.sceneIndex ?? index}`,
        message: `Scene ${Number(scene.sceneIndex ?? index) + 1}: ${promptIssue.message}`,
        suggestion: 'Tighten scene wording before approval; see docs/PROMPT_QUALITY.md.',
      });
    }
  }
  return issues;
}

export function checkDialogueFit(storyboard: StoryboardArtifact): DirectorPreflightIssue[] {
  return checkDialogueDurationFit({
    scenes: storyboard.scenes ?? [],
  }).map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    scope: `scene:${issue.sceneIndex}`,
    message: issue.message,
    suggestion: issue.suggestion,
  }));
}

export function checkDistinctScenes(storyboard: StoryboardArtifact): DirectorPreflightIssue[] {
  const issues: DirectorPreflightIssue[] = [];
  const scenes = storyboard.scenes ?? [];
  for (let index = 1; index < scenes.length; index += 1) {
    const previous = new Set(normalizeWords(sceneText(scenes[index - 1])));
    const current = new Set(normalizeWords(sceneText(scenes[index])));
    if (previous.size === 0 || current.size === 0) continue;
    const shared = [...current].filter((word) => previous.has(word));
    const overlap = shared.length / Math.max(previous.size, current.size);
    if (overlap >= 0.75) {
      issues.push({
        severity: 'warn',
        code: 'SCENE_REPEAT',
        scope: `scene:${scenes[index].sceneIndex ?? index}`,
        message: `Scene ${index + 1} heavily overlaps Scene ${index} and may not be visually distinct.`,
        suggestion: 'Increase beat separation so adjacent scenes are not near-duplicates.',
      });
    }
  }
  return issues;
}

export async function checkRemoteReferenceAssets(
  profiles: CharacterProfile[],
  fetcher: typeof fetch = fetch,
): Promise<DirectorPreflightIssue[]> {
  const issues: DirectorPreflightIssue[] = [];
  for (const profile of profiles) {
    for (const asset of profile.referenceAssets ?? []) {
      if (!asset.startsWith('http')) continue;
      try {
        const response = await fetcher(asset, { method: 'HEAD' });
        if (!response.ok) {
          issues.push({
            severity: 'error',
            code: 'REF_IMAGE_UNREACHABLE',
            scope: `character:${profile.name}`,
            message: `Reference asset for ${profile.name} returned HTTP ${response.status}.`,
            suggestion: 'Replace or re-upload the reference asset before director execution.',
          });
        }
      } catch (error) {
        issues.push({
          severity: 'warn',
          code: 'REF_IMAGE_PROBE_FAILED',
          scope: `character:${profile.name}`,
          message: `Could not probe remote reference asset for ${profile.name}: ${(error as Error).message}`,
        });
      }
    }
  }
  return issues;
}

export async function checkGoBananasCharacterIds(
  profiles: CharacterProfile[],
  apiKey: string | undefined,
  apiBase: string,
  fetcher: typeof fetch = fetch,
): Promise<DirectorPreflightIssue[]> {
  if (!apiKey) return [];
  const issues: DirectorPreflightIssue[] = [];
  for (const profile of profiles) {
    if (!profile.goBananasId) continue;
    try {
      const response = await fetcher(`${apiBase}/characters/${profile.goBananasId}`, {
        headers: {
          'X-API-Key': apiKey,
          'Accept': 'application/json',
        },
      });
      if (response.status === 404) {
        issues.push({
          severity: 'error',
          code: 'CHAR_ID_NOT_FOUND',
          scope: `character:${profile.name}`,
          message: `Go Bananas character id ${profile.goBananasId} for ${profile.name} was not found.`,
          suggestion: `Recheck the id or create the character before running director execution.`,
        });
        continue;
      }
      if (!response.ok) {
        issues.push({
          severity: 'warn',
          code: 'CHAR_ID_PROBE_FAILED',
          scope: `character:${profile.name}`,
          message: `Go Bananas probe for ${profile.name} returned HTTP ${response.status}.`,
        });
        continue;
      }
      const body = await response.json() as { data?: { reference_images?: unknown[] } } | { reference_images?: unknown[] };
      const character = (Object.prototype.hasOwnProperty.call(body, 'data')
        ? (body as { data?: { reference_images?: unknown[] } }).data
        : body) ?? {};
      const referenceImages = (character as { reference_images?: unknown[] }).reference_images ?? [];
      if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
        issues.push({
          severity: 'error',
          code: 'CHAR_NO_REF_IMAGE',
          scope: `character:${profile.name}`,
          message: `Go Bananas character ${profile.name} (id=${profile.goBananasId}) has no reference images.`,
          suggestion: 'Add at least one Go Bananas reference image or attach a local reference asset.',
        });
      }
    } catch (error) {
      issues.push({
        severity: 'warn',
        code: 'CHAR_ID_NETWORK',
        scope: `character:${profile.name}`,
        message: `Network error probing Go Bananas id ${profile.goBananasId}: ${(error as Error).message}`,
      });
    }
  }
  return issues;
}

export function applyContentFilterSubstitutions(text: string): { text: string; changes: number } {
  let next = text;
  let changes = 0;
  for (const { pattern, replacement } of CONTENT_FILTER_HAZARDS) {
    pattern.lastIndex = 0;
    const before = next;
    next = next.replace(pattern, replacement);
    if (next !== before) {
      changes += 1;
    }
  }
  return { text: next, changes };
}

export async function autoFixDirectorStoryboardContent(
  projectSlug: string,
  root = process.cwd(),
): Promise<{ artifactPath: string; changeCount: number } | null> {
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const storyboardPath = artifactPathFor(workspace, 'storyboard');
  const storyboard = JSON.parse(
    await readFile(storyboardPath, 'utf-8'),
  ) as {
    projectSlug: string;
    productionMode: VideoProductionMode;
    scenes: Array<{
      sceneIndex: number;
      description: string;
      dialogue?: string;
      characters?: string[];
      durationSeconds?: number;
    }>;
  };

  let changeCount = 0;
  const scenes = storyboard.scenes.map((scene) => {
    const description = applyContentFilterSubstitutions(scene.description ?? '');
    const dialogue = scene.dialogue
      ? applyContentFilterSubstitutions(scene.dialogue)
      : { text: scene.dialogue, changes: 0 };
    changeCount += description.changes + dialogue.changes;
    return {
      ...scene,
      description: description.text,
      ...(scene.dialogue !== undefined ? { dialogue: dialogue.text } : {}),
    };
  });

  if (changeCount === 0) {
    return null;
  }

  const artifactPath = await writeArtifact(workspace, 'storyboard', {
    ...storyboard,
    scenes,
  });
  await appendProjectEvent(workspace, {
    type: 'director.storyboard.auto-fixed',
    recordedAt: new Date().toISOString(),
    payload: { artifactPath, changeCount },
  });
  return { artifactPath, changeCount };
}

async function readReferenceSheetsArtifactForPreflight(
  root: string,
  slug: string,
): Promise<ReferenceSheetsArtifact> {
  const path = referenceSheetsPathFor(root, slug);
  if (!existsSync(path)) {
    return { schemaVersion: 1, sheets: [] };
  }
  try {
    return await readReferenceSheetsArtifact(root, slug);
  } catch {
    // Read bypasses the store's validator so preflight can surface the
    // validation errors as issues rather than crash.
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as ReferenceSheetsArtifact;
    return parsed;
  }
}

export function checkReferenceSheetValidation(
  artifact: ReferenceSheetsArtifact,
): DirectorPreflightIssue[] {
  const issues: DirectorPreflightIssue[] = [];
  const validation = validateArtifact(artifact);
  for (const err of validation.errors) {
    if (err.startsWith('unassigned-role')) {
      issues.push({
        severity: 'error',
        code: 'unassigned-role',
        scope: 'reference-sheets',
        message: err,
        suggestion: 'Add a role to every reference entry before running director execution.',
      });
    } else if (err.startsWith('role-vocabulary-violation')) {
      issues.push({
        severity: 'error',
        code: 'role-vocabulary-violation',
        scope: 'reference-sheets',
        message: err,
        suggestion: 'Use a role allowed by the sheet-type vocabulary (see reference-sheets docs).',
      });
    } else {
      issues.push({
        severity: 'error',
        code: 'reference-sheet-invalid',
        scope: 'reference-sheets',
        message: err,
      });
    }
  }
  return issues;
}

export function checkReferenceSheetRoleCollisions(
  artifact: ReferenceSheetsArtifact,
): DirectorPreflightIssue[] {
  const issues: DirectorPreflightIssue[] = [];
  for (const collision of findRoleCollisions(artifact)) {
    issues.push({
      severity: 'error',
      code: 'role-collision',
      scope: `scene:${collision.sceneIndex}`,
      message: `scene ${collision.sceneIndex}: role=${collision.role} supplied by sheets ${collision.sheetIds.join(', ')}`,
      suggestion: 'Remove one of the colliding sheets from the scene binding or change its role.',
    });
  }
  return issues;
}

export async function checkReferenceSheetGbRefs(
  artifact: ReferenceSheetsArtifact,
  apiKey: string | undefined,
  apiBase: string,
  fetcher: typeof fetch = fetch,
): Promise<DirectorPreflightIssue[]> {
  if (!apiKey) return [];
  const issues: DirectorPreflightIssue[] = [];
  for (const sheet of artifact.sheets) {
    for (const ref of sheet.references) {
      if (!('gbRef' in ref)) continue;
      const { kind, id } = ref.gbRef;
      // Only character kind has a verified probe path in this codebase
      // (matches checkGoBananasCharacterIds). Other kinds are acknowledged
      // but not probed to avoid inventing new GB endpoints.
      if (kind !== 'character') {
        issues.push({
          severity: 'warn',
          code: 'reference-sheet-gb-ref-probe-pending',
          scope: `sheet:${sheet.id}`,
          message: `TODO: GB-ref resolution pending for kind=${kind} id=${id} on sheet ${sheet.id}`,
          suggestion: 'GB-ref probing for non-character kinds is not yet wired; resolve manually.',
        });
        continue;
      }
      try {
        const response = await fetcher(`${apiBase}/characters/${id}`, {
          headers: {
            'X-API-Key': apiKey,
            'Accept': 'application/json',
          },
        });
        if (response.status === 404) {
          issues.push({
            severity: 'error',
            code: 'reference-sheet-orphan-gb-ref',
            scope: `sheet:${sheet.id}`,
            message: `Go Bananas ${kind} id=${id} referenced by sheet ${sheet.id} was not found.`,
            suggestion: `Recheck the id or remove the orphan gbRef from sheet ${sheet.id}.`,
          });
          continue;
        }
        if (!response.ok) {
          issues.push({
            severity: 'warn',
            code: 'reference-sheet-gb-ref-probe-failed',
            scope: `sheet:${sheet.id}`,
            message: `Go Bananas probe for ${kind} id=${id} (sheet ${sheet.id}) returned HTTP ${response.status}.`,
          });
        }
      } catch (error) {
        issues.push({
          severity: 'warn',
          code: 'reference-sheet-gb-ref-network',
          scope: `sheet:${sheet.id}`,
          message: `Network error probing Go Bananas ${kind} id=${id} for sheet ${sheet.id}: ${(error as Error).message}`,
        });
      }
    }
  }
  return issues;
}

export async function runDirectorPreflight(
  projectSlug: string,
  root = process.cwd(),
  options: { fetcher?: typeof fetch; apiKey?: string; apiBase?: string } = {},
): Promise<DirectorPreflightResult> {
  const workspace = resolveProjectWorkspace(projectSlug, root);
  const storyboardPath = artifactPathFor(workspace, 'storyboard');
  if (!existsSync(storyboardPath)) {
    return {
      pass: false,
      errors: [{
        severity: 'error',
        code: 'STORYBOARD_MISSING',
        scope: 'project',
        message: 'Storyboard artifact is missing.',
        suggestion: 'Create the storyboard before running director execution.',
      }],
      warnings: [],
    };
  }

  const storyboard = JSON.parse(await readFile(storyboardPath, 'utf-8')) as StoryboardArtifact;
  const profiles = await listCharacterProfiles(workspace);
  const apiKey = options.apiKey ?? process.env.GO_BANANAS_API_KEY;
  const apiBase = options.apiBase ?? (process.env.GO_BANANAS_API_URL?.trim() || 'https://gobananasai.com/api');
  const referenceSheets = await readReferenceSheetsArtifactForPreflight(workspace.root, projectSlug);
  const issues = [
    ...checkContentFilterHazards(storyboard),
    ...checkPronounConsistency(storyboard, profiles),
    ...checkDistinctScenes(storyboard),
    ...checkPromptQuality(storyboard),
    ...checkDialogueFit(storyboard),
    ...await checkGoBananasCharacterIds(profiles, apiKey, apiBase, options.fetcher),
    ...await checkRemoteReferenceAssets(profiles, options.fetcher),
    ...checkReferenceSheetValidation(referenceSheets),
    ...checkReferenceSheetRoleCollisions(referenceSheets),
    ...await checkReferenceSheetGbRefs(referenceSheets, apiKey, apiBase, options.fetcher),
  ];

  return {
    pass: issues.every((issue) => issue.severity !== 'error'),
    errors: issues.filter((issue) => issue.severity === 'error'),
    warnings: issues.filter((issue) => issue.severity === 'warn'),
  };
}
