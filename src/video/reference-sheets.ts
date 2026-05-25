import type {
  ReferenceEntry,
  ReferenceRole,
  ReferenceSheet,
  ReferenceSheetType,
  ReferenceSheetsArtifact,
} from './types.js';

export const ROLE_VOCABULARY: Record<ReferenceSheetType, readonly ReferenceRole[]> = {
  'identity': ['identity', 'wardrobe', 'silhouette', 'age-reference'],
  'outfit-material': [
    'outfit', 'material', 'accessory', 'texture',
    'product-hero', 'product-variant', 'product-in-use', 'packaging',
  ],
  'environment': ['location', 'set-dressing', 'weather', 'time-of-day'],
  'motion-camera': ['motion-rhythm', 'camera-behavior', 'blocking', 'shot-framing'],
  'palette-mood': ['palette', 'composition', 'mood', 'lighting-reference'],
};

export const REFERENCE_SHEET_TYPES: readonly ReferenceSheetType[] = [
  'identity',
  'outfit-material',
  'environment',
  'motion-camera',
  'palette-mood',
];

export function isRoleValidForType(role: ReferenceRole, type: ReferenceSheetType): boolean {
  return (ROLE_VOCABULARY[type] as readonly ReferenceRole[]).includes(role);
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateSheet(sheet: ReferenceSheet): ValidationResult {
  const errors: string[] = [];

  if (!REFERENCE_SHEET_TYPES.includes(sheet.type)) {
    errors.push(`unknown-sheet-type: ${sheet.type}`);
  }

  for (const [i, ref] of sheet.references.entries()) {
    if (!ref.role) {
      errors.push(`unassigned-role: sheet=${sheet.id} ref-index=${i}`);
      continue;
    }
    if (!isRoleValidForType(ref.role, sheet.type)) {
      errors.push(`role-vocabulary-violation: sheet=${sheet.id} role=${ref.role} type=${sheet.type}`);
    }
  }

  for (const sceneIndex of sheet.bindings.sceneIndices) {
    if (!Number.isInteger(sceneIndex) || sceneIndex < 0) {
      errors.push(`invalid-scene-index: sheet=${sheet.id} sceneIndex=${sceneIndex}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function validateArtifact(artifact: ReferenceSheetsArtifact): ValidationResult {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  for (const sheet of artifact.sheets) {
    if (seenIds.has(sheet.id)) {
      errors.push(`duplicate-sheet-id: ${sheet.id}`);
    }
    seenIds.add(sheet.id);
    const sheetResult = validateSheet(sheet);
    errors.push(...sheetResult.errors);
  }
  return { ok: errors.length === 0, errors };
}

export interface CreateSheetInput {
  type: ReferenceSheetType;
  name: string;
  description?: string;
  characterName?: string;
  id?: string;
  existingIds: string[];
  now?: Date;
}

export function createSheet(input: CreateSheetInput): ReferenceSheet {
  const now = (input.now ?? new Date()).toISOString();
  const id = input.id ?? nextSheetId(input.existingIds);
  const sheet: ReferenceSheet = {
    id,
    type: input.type,
    name: input.name,
    references: [],
    bindings: { sceneIndices: [] },
    createdAt: now,
    updatedAt: now,
  };
  if (input.description !== undefined) sheet.description = input.description;
  if (input.characterName !== undefined) sheet.characterName = input.characterName;
  return sheet;
}

function nextSheetId(existing: string[]): string {
  const used = new Set(existing);
  for (let n = 1; n < 10_000; n++) {
    const candidate = `sheet-${String(n).padStart(3, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('ran out of sheet ids');
}

export function addReferenceToSheet(
  sheet: ReferenceSheet,
  entry: ReferenceEntry,
  now: Date = new Date(),
): ReferenceSheet {
  return {
    ...sheet,
    references: [...sheet.references, entry],
    updatedAt: now.toISOString(),
  };
}

export function bindSheetToScenes(
  sheet: ReferenceSheet,
  sceneIndices: number[],
  now: Date = new Date(),
): ReferenceSheet {
  const merged = Array.from(new Set([...sheet.bindings.sceneIndices, ...sceneIndices]))
    .sort((a, b) => a - b);
  return {
    ...sheet,
    bindings: { sceneIndices: merged },
    updatedAt: now.toISOString(),
  };
}

export function findSheet(
  artifact: ReferenceSheetsArtifact,
  id: string,
): ReferenceSheet | undefined {
  return artifact.sheets.find((s) => s.id === id);
}

export function removeSheet(
  artifact: ReferenceSheetsArtifact,
  id: string,
): ReferenceSheetsArtifact {
  return {
    ...artifact,
    sheets: artifact.sheets.filter((s) => s.id !== id),
  };
}

export function upsertSheet(
  artifact: ReferenceSheetsArtifact,
  sheet: ReferenceSheet,
): ReferenceSheetsArtifact {
  const idx = artifact.sheets.findIndex((s) => s.id === sheet.id);
  const next = [...artifact.sheets];
  if (idx >= 0) next[idx] = sheet;
  else next.push(sheet);
  return { ...artifact, sheets: next };
}

export interface RoleCollision {
  sceneIndex: number;
  role: ReferenceRole;
  sheetIds: string[];
}

export function findRoleCollisions(artifact: ReferenceSheetsArtifact): RoleCollision[] {
  const byScene = new Map<number, Map<ReferenceRole, string[]>>();
  for (const sheet of artifact.sheets) {
    for (const sceneIndex of sheet.bindings.sceneIndices) {
      const rolesForScene = byScene.get(sceneIndex) ?? new Map<ReferenceRole, string[]>();
      for (const ref of sheet.references) {
        const ids = rolesForScene.get(ref.role) ?? [];
        if (!ids.includes(sheet.id)) ids.push(sheet.id);
        rolesForScene.set(ref.role, ids);
      }
      byScene.set(sceneIndex, rolesForScene);
    }
  }
  const collisions: RoleCollision[] = [];
  for (const [sceneIndex, roles] of byScene) {
    for (const [role, ids] of roles) {
      if (ids.length > 1) collisions.push({ sceneIndex, role, sheetIds: ids });
    }
  }
  return collisions;
}

export interface ArtifactSummary {
  count: number;
  byType: Partial<Record<ReferenceSheetType, number>>;
  boundSceneCount: number;
  unboundSheetIds: string[];
}

export function summarizeArtifact(artifact: ReferenceSheetsArtifact): ArtifactSummary {
  const byType: Partial<Record<ReferenceSheetType, number>> = {};
  const boundScenes = new Set<number>();
  const unbound: string[] = [];
  for (const sheet of artifact.sheets) {
    byType[sheet.type] = (byType[sheet.type] ?? 0) + 1;
    if (sheet.bindings.sceneIndices.length === 0) unbound.push(sheet.id);
    for (const i of sheet.bindings.sceneIndices) boundScenes.add(i);
  }
  return {
    count: artifact.sheets.length,
    byType,
    boundSceneCount: boundScenes.size,
    unboundSheetIds: unbound,
  };
}

export function sheetsCoveringScene(
  artifact: ReferenceSheetsArtifact,
  sceneIndex: number,
): ReferenceSheet[] {
  return artifact.sheets.filter((s) => s.bindings.sceneIndices.includes(sceneIndex));
}
