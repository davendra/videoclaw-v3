# Reference Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reference sheets as a first-class concept that tags every generator reference with its job (identity, wardrobe, palette, motion-rhythm, etc.), with CLI surface, preflight integration, and full ops-surface visibility.

**Architecture:** Sheets live beside characters (not replacing them) at `projects/<slug>/references/reference-sheets.json`. Five sheet types with closed role vocabularies. Only the Identity Sheet is wired into blocking readiness in v1; all five participate in three validation checks (unassigned-role, role-vocabulary-violation, role-collision) when present.

**Tech Stack:** TypeScript (strict, NodeNext ESM), Node 20, `node:test` with `assert/strict`, JSON Schema artifacts under `schemas/video/`.

**Spec:** [`docs/superpowers/specs/2026-04-22-reference-sheets-design.md`](../specs/2026-04-22-reference-sheets-design.md)

---

## File structure

### New files

| File | Responsibility |
|---|---|
| `schemas/video/artifacts/reference-sheets.schema.json` | JSON Schema contract |
| `src/video/types.ts` *(modified)* | Type definitions for sheets, roles, entries |
| `src/video/reference-sheets.ts` | Pure functions: role vocab, validation, mutation primitives, collision detection |
| `src/video/reference-sheet-store.ts` | Read/write artifact from/to disk |
| `src/tests/reference-sheets.test.ts` | Module contract tests |
| `src/tests/reference-sheet-store.test.ts` | Store round-trip tests |
| `src/tests/cli-reference-sheets.test.ts` | CLI end-to-end tests |
| `scripts/smoke-reference-sheets.mjs` | End-to-end smoke |
| `docs/REFERENCE_SHEETS.md` | Operator guide |

### Modified files

- `src/cli/vclaw.ts` — five new subcommands + help text
- `src/video/readiness.ts` — Identity Sheet gate for director-mode
- `src/video/director-preflight.ts` — three new checks
- `src/video/doctor.ts`, `src/video/doctor-portfolio.ts` — sheet completeness rollup
- `src/video/status.ts`, `src/video/project-index.ts`, `src/video/report.ts`, `src/video/csv-export.ts`, `src/video/obsidian-export.ts` — sheet summary
- `src/video/storyboard-markdown.ts` — sheet section in director review
- `src/index.ts` — public re-exports
- `scripts/check-release-readiness-lite.sh`, `package.json` — smoke wiring
- `README.md`, `docs/CLI_REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/MASTER_PLAN_ALIGNMENT.md` — docs updates

---

## Phase 0 — Foundation

### Task 1: JSON Schema + types

**Files:**
- Create: `schemas/video/artifacts/reference-sheets.schema.json`
- Modify: `src/video/types.ts`
- Test: `src/tests/reference-sheets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/tests/reference-sheets.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReferenceSheet, ReferenceSheetsArtifact } from '../video/types.js';

test('ReferenceSheetsArtifact shape is importable and type-compatible', () => {
  const artifact: ReferenceSheetsArtifact = {
    schemaVersion: 1,
    sheets: [],
  };
  assert.equal(artifact.schemaVersion, 1);
  assert.deepEqual(artifact.sheets, []);
});

test('ReferenceSheet carries required fields', () => {
  const sheet: ReferenceSheet = {
    id: 'sheet-001',
    type: 'identity',
    name: 'Lead',
    references: [{ path: 'refs/mochi.png', role: 'identity' }],
    bindings: { sceneIndices: [1, 2] },
    createdAt: '2026-04-22T10:00:00.000Z',
    updatedAt: '2026-04-22T10:00:00.000Z',
  };
  assert.equal(sheet.type, 'identity');
  assert.equal(sheet.references[0].role, 'identity');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build 2>&1 | tail -20`
Expected: FAIL with type errors on `ReferenceSheet` / `ReferenceSheetsArtifact` not being exported.

- [ ] **Step 3: Add types to `src/video/types.ts`**

Append to `src/video/types.ts`:

```typescript
export type ReferenceSheetType =
  | 'identity'
  | 'outfit-material'
  | 'environment'
  | 'motion-camera'
  | 'palette-mood';

export type ReferenceRole =
  // identity
  | 'identity' | 'wardrobe' | 'silhouette' | 'age-reference'
  // outfit-material
  | 'outfit' | 'material' | 'accessory' | 'texture'
  // environment
  | 'location' | 'set-dressing' | 'weather' | 'time-of-day'
  // motion-camera
  | 'motion-rhythm' | 'camera-behavior' | 'blocking' | 'shot-framing'
  // palette-mood
  | 'palette' | 'composition' | 'mood' | 'lighting-reference';

export interface ReferenceEntry {
  path: string;
  role: ReferenceRole;
  note?: string;
}

export interface ReferenceSheetBindings {
  sceneIndices: number[];
}

export interface ReferenceSheet {
  id: string;
  type: ReferenceSheetType;
  name: string;
  description?: string;
  characterName?: string;
  references: ReferenceEntry[];
  bindings: ReferenceSheetBindings;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceSheetsArtifact {
  schemaVersion: 1;
  sheets: ReferenceSheet[];
}
```

- [ ] **Step 4: Create the JSON Schema**

Create `schemas/video/artifacts/reference-sheets.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://vclaw.dev/schemas/video/artifacts/reference-sheets.schema.json",
  "title": "ReferenceSheetsArtifact",
  "type": "object",
  "required": ["schemaVersion", "sheets"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": { "const": 1 },
    "sheets": {
      "type": "array",
      "items": { "$ref": "#/definitions/ReferenceSheet" }
    }
  },
  "definitions": {
    "ReferenceSheet": {
      "type": "object",
      "required": ["id", "type", "name", "references", "bindings", "createdAt", "updatedAt"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "type": { "enum": ["identity", "outfit-material", "environment", "motion-camera", "palette-mood"] },
        "name": { "type": "string", "minLength": 1 },
        "description": { "type": "string" },
        "characterName": { "type": "string" },
        "references": {
          "type": "array",
          "items": { "$ref": "#/definitions/ReferenceEntry" }
        },
        "bindings": {
          "type": "object",
          "required": ["sceneIndices"],
          "additionalProperties": false,
          "properties": {
            "sceneIndices": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
          }
        },
        "createdAt": { "type": "string", "format": "date-time" },
        "updatedAt": { "type": "string", "format": "date-time" }
      }
    },
    "ReferenceEntry": {
      "type": "object",
      "required": ["path", "role"],
      "additionalProperties": false,
      "properties": {
        "path": { "type": "string", "minLength": 1 },
        "role": {
          "enum": [
            "identity", "wardrobe", "silhouette", "age-reference",
            "outfit", "material", "accessory", "texture",
            "location", "set-dressing", "weather", "time-of-day",
            "motion-rhythm", "camera-behavior", "blocking", "shot-framing",
            "palette", "composition", "mood", "lighting-reference"
          ]
        },
        "note": { "type": "string" }
      }
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/reference-sheets.test.js`
Expected: both `test` calls pass.

- [ ] **Step 6: Commit**

```bash
git add schemas/video/artifacts/reference-sheets.schema.json src/video/types.ts src/tests/reference-sheets.test.ts
git commit -m "Add reference-sheets schema and types"
```

---

## Phase 1 — Core module

### Task 2: Role vocabulary + validation

**Files:**
- Create: `src/video/reference-sheets.ts`
- Test: `src/tests/reference-sheets.test.ts` *(extend)*

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/reference-sheets.test.ts`:

```typescript
import {
  ROLE_VOCABULARY,
  isRoleValidForType,
  validateSheet,
} from '../video/reference-sheets.js';

test('ROLE_VOCABULARY covers all 5 types', () => {
  assert.deepEqual(Object.keys(ROLE_VOCABULARY).sort(), [
    'environment',
    'identity',
    'motion-camera',
    'outfit-material',
    'palette-mood',
  ]);
});

test('isRoleValidForType enforces per-type vocabulary', () => {
  assert.equal(isRoleValidForType('identity', 'identity'), true);
  assert.equal(isRoleValidForType('palette', 'identity'), false);
  assert.equal(isRoleValidForType('palette', 'palette-mood'), true);
  assert.equal(isRoleValidForType('wardrobe', 'outfit-material'), false);
});

test('validateSheet catches role-vocabulary violations', () => {
  const result = validateSheet({
    id: 's1',
    type: 'identity',
    name: 'X',
    references: [{ path: 'a.png', role: 'palette' }],
    bindings: { sceneIndices: [] },
    createdAt: 'T', updatedAt: 'T',
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('|'), /role-vocabulary-violation/);
});

test('validateSheet accepts a well-formed sheet', () => {
  const result = validateSheet({
    id: 's1',
    type: 'identity',
    name: 'X',
    references: [{ path: 'a.png', role: 'identity' }],
    bindings: { sceneIndices: [0] },
    createdAt: 'T', updatedAt: 'T',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build 2>&1 | tail -20`
Expected: module not found or exports missing.

- [ ] **Step 3: Implement `src/video/reference-sheets.ts`**

Create `src/video/reference-sheets.ts`:

```typescript
import type {
  ReferenceEntry,
  ReferenceRole,
  ReferenceSheet,
  ReferenceSheetType,
  ReferenceSheetsArtifact,
} from './types.js';

export const ROLE_VOCABULARY: Record<ReferenceSheetType, readonly ReferenceRole[]> = {
  'identity': ['identity', 'wardrobe', 'silhouette', 'age-reference'],
  'outfit-material': ['outfit', 'material', 'accessory', 'texture'],
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/reference-sheets.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/video/reference-sheets.ts src/tests/reference-sheets.test.ts
git commit -m "Add reference-sheet role vocabulary and validation"
```

---

### Task 3: Sheet mutation primitives

**Files:**
- Modify: `src/video/reference-sheets.ts`
- Test: `src/tests/reference-sheets.test.ts` *(extend)*

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/reference-sheets.test.ts`:

```typescript
import {
  createSheet,
  addReferenceToSheet,
  bindSheetToScenes,
  findSheet,
  removeSheet,
} from '../video/reference-sheets.js';

test('createSheet generates a stable id and timestamps', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const sheet = createSheet({
    type: 'identity',
    name: 'Lead',
    existingIds: [],
    now,
  });
  assert.equal(sheet.id, 'sheet-001');
  assert.equal(sheet.type, 'identity');
  assert.deepEqual(sheet.references, []);
  assert.deepEqual(sheet.bindings.sceneIndices, []);
  assert.equal(sheet.createdAt, '2026-04-22T10:00:00.000Z');
});

test('createSheet picks next free id', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const sheet = createSheet({
    type: 'palette-mood',
    name: 'Dusk',
    existingIds: ['sheet-001', 'sheet-002'],
    now,
  });
  assert.equal(sheet.id, 'sheet-003');
});

test('createSheet honors explicit id', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const sheet = createSheet({
    type: 'identity', name: 'Lead', id: 'lead-v1',
    existingIds: [], now,
  });
  assert.equal(sheet.id, 'lead-v1');
});

test('addReferenceToSheet appends and updates updatedAt', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  let sheet = createSheet({ type: 'identity', name: 'Lead', existingIds: [], now });
  sheet = addReferenceToSheet(sheet, { path: 'a.png', role: 'identity' }, new Date('2026-04-22T11:00:00.000Z'));
  assert.equal(sheet.references.length, 1);
  assert.equal(sheet.updatedAt, '2026-04-22T11:00:00.000Z');
});

test('bindSheetToScenes dedupes and sorts', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  let sheet = createSheet({ type: 'identity', name: 'Lead', existingIds: [], now });
  sheet = bindSheetToScenes(sheet, [2, 1, 2, 3], now);
  assert.deepEqual(sheet.bindings.sceneIndices, [1, 2, 3]);
});

test('findSheet and removeSheet work', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const s1 = createSheet({ type: 'identity', name: 'A', existingIds: [], now });
  const s2 = createSheet({ type: 'palette-mood', name: 'B', existingIds: ['sheet-001'], now });
  const artifact = { schemaVersion: 1 as const, sheets: [s1, s2] };
  assert.equal(findSheet(artifact, 'sheet-002')?.name, 'B');
  const reduced = removeSheet(artifact, 'sheet-001');
  assert.equal(reduced.sheets.length, 1);
  assert.equal(reduced.sheets[0].id, 'sheet-002');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build 2>&1 | tail -20`
Expected: export errors.

- [ ] **Step 3: Implement the mutation primitives**

Append to `src/video/reference-sheets.ts`:

```typescript
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
  return {
    id,
    type: input.type,
    name: input.name,
    description: input.description,
    characterName: input.characterName,
    references: [],
    bindings: { sceneIndices: [] },
    createdAt: now,
    updatedAt: now,
  };
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/reference-sheets.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/video/reference-sheets.ts src/tests/reference-sheets.test.ts
git commit -m "Add reference-sheet mutation primitives"
```

---

### Task 4: Scene-level analysis (collision detection)

**Files:**
- Modify: `src/video/reference-sheets.ts`
- Test: `src/tests/reference-sheets.test.ts` *(extend)*

- [ ] **Step 1: Write the failing tests**

Append:

```typescript
import {
  findRoleCollisions,
  summarizeArtifact,
} from '../video/reference-sheets.js';

test('findRoleCollisions detects two sheets providing the same role on the same scene', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const s1 = addReferenceToSheet(
    bindSheetToScenes(createSheet({ type: 'palette-mood', name: 'A', existingIds: [], now }), [1], now),
    { path: 'a.png', role: 'palette' }, now);
  const s2 = addReferenceToSheet(
    bindSheetToScenes(createSheet({ type: 'palette-mood', name: 'B', existingIds: ['sheet-001'], now }), [1], now),
    { path: 'b.png', role: 'palette' }, now);
  const collisions = findRoleCollisions({ schemaVersion: 1, sheets: [s1, s2] });
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].sceneIndex, 1);
  assert.equal(collisions[0].role, 'palette');
  assert.deepEqual(collisions[0].sheetIds.sort(), ['sheet-001', 'sheet-002']);
});

test('findRoleCollisions returns empty when roles differ', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const s1 = addReferenceToSheet(
    bindSheetToScenes(createSheet({ type: 'palette-mood', name: 'A', existingIds: [], now }), [1], now),
    { path: 'a.png', role: 'palette' }, now);
  const s2 = addReferenceToSheet(
    bindSheetToScenes(createSheet({ type: 'palette-mood', name: 'B', existingIds: ['sheet-001'], now }), [1], now),
    { path: 'b.png', role: 'composition' }, now);
  const collisions = findRoleCollisions({ schemaVersion: 1, sheets: [s1, s2] });
  assert.deepEqual(collisions, []);
});

test('summarizeArtifact counts sheets by type and bindings', () => {
  const now = new Date('2026-04-22T10:00:00.000Z');
  const a = bindSheetToScenes(createSheet({ type: 'identity', name: 'A', existingIds: [], now }), [0, 1], now);
  const b = createSheet({ type: 'palette-mood', name: 'B', existingIds: ['sheet-001'], now });
  const summary = summarizeArtifact({ schemaVersion: 1, sheets: [a, b] });
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.byType, { identity: 1, 'palette-mood': 1 });
  assert.deepEqual(summary.boundSceneCount, 2);
  assert.deepEqual(summary.unboundSheetIds, ['sheet-002']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build 2>&1 | tail -20`
Expected: missing exports.

- [ ] **Step 3: Implement analysis**

Append to `src/video/reference-sheets.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/reference-sheets.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/video/reference-sheets.ts src/tests/reference-sheets.test.ts
git commit -m "Add reference-sheet collision detection and summary"
```

---

## Phase 2 — Store

### Task 5: Reference-sheet store (disk I/O)

**Files:**
- Create: `src/video/reference-sheet-store.ts`
- Test: `src/tests/reference-sheet-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/reference-sheet-store.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureProjectWorkspace } from '../video/workspace.js';
import {
  readReferenceSheetsArtifact,
  writeReferenceSheetsArtifact,
  referenceSheetsPathFor,
} from '../video/reference-sheet-store.js';
import { createSheet } from '../video/reference-sheets.js';

test('read returns empty artifact when file does not exist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-refsheet-'));
  await ensureProjectWorkspace(root, 'demo', { mode: 'director' });
  const artifact = await readReferenceSheetsArtifact(root, 'demo');
  assert.equal(artifact.schemaVersion, 1);
  assert.deepEqual(artifact.sheets, []);
});

test('write then read round-trips', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-refsheet-'));
  await ensureProjectWorkspace(root, 'demo', { mode: 'director' });
  const now = new Date('2026-04-22T10:00:00.000Z');
  const sheet = createSheet({ type: 'identity', name: 'Lead', existingIds: [], now });
  const artifact = { schemaVersion: 1 as const, sheets: [sheet] };
  await writeReferenceSheetsArtifact(root, 'demo', artifact);
  assert.equal(existsSync(referenceSheetsPathFor(root, 'demo')), true);
  const readBack = await readReferenceSheetsArtifact(root, 'demo');
  assert.deepEqual(readBack, artifact);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build 2>&1 | tail -20`
Expected: module not found.

- [ ] **Step 3: Implement the store**

Create `src/video/reference-sheet-store.ts`:

```typescript
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { resolveProjectWorkspace } from './workspace.js';
import type { ReferenceSheetsArtifact } from './types.js';
import { validateArtifact } from './reference-sheets.js';

export function referenceSheetsPathFor(root: string, slug: string): string {
  return join(resolveProjectWorkspace(root, slug), 'references', 'reference-sheets.json');
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
  await writeFile(path, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/reference-sheet-store.test.js`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/video/reference-sheet-store.ts src/tests/reference-sheet-store.test.ts
git commit -m "Add reference-sheet disk store with round-trip"
```

---

## Phase 3 — CLI commands

### Task 6: `reference-sheet-add`

**Files:**
- Modify: `src/cli/vclaw.ts`
- Test: `src/tests/cli-reference-sheets.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/cli-reference-sheets.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  const res = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status ?? -1 };
}

test('reference-sheet-add creates an Identity Sheet with a valid role', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  const add = run([
    'video', 'reference-sheet-add',
    '--project', 'demo',
    '--root', root,
    '--type', 'identity',
    '--name', 'Lead',
    '--ref', 'refs/mochi.png:identity',
    '--binding', '0',
  ]);
  assert.equal(add.status, 0, `stderr: ${add.stderr}`);
  const payload = JSON.parse(add.stdout);
  assert.equal(payload.sheet.type, 'identity');
  assert.equal(payload.sheet.references[0].role, 'identity');
  assert.deepEqual(payload.sheet.bindings.sceneIndices, [0]);

  const artifactPath = join(root, 'projects', 'demo', 'references', 'reference-sheets.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  assert.equal(artifact.sheets.length, 1);
});

test('reference-sheet-add rejects a role outside the sheet-type vocabulary', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  const add = run([
    'video', 'reference-sheet-add',
    '--project', 'demo',
    '--root', root,
    '--type', 'identity',
    '--name', 'BadRole',
    '--ref', 'refs/x.png:palette',
  ]);
  assert.notEqual(add.status, 0);
  assert.match(add.stderr, /role-vocabulary-violation/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test dist/tests/cli-reference-sheets.test.js`
Expected: FAIL — unknown subcommand.

- [ ] **Step 3: Implement the CLI handler**

Add to `src/cli/vclaw.ts` at the top with other imports:

```typescript
import {
  readReferenceSheetsArtifact,
  writeReferenceSheetsArtifact,
} from '../video/reference-sheet-store.js';
import {
  addReferenceToSheet,
  bindSheetToScenes,
  createSheet,
  findRoleCollisions,
  findSheet,
  isRoleValidForType,
  removeSheet,
  summarizeArtifact,
  upsertSheet,
  validateArtifact,
  REFERENCE_SHEET_TYPES,
  ROLE_VOCABULARY,
} from '../video/reference-sheets.js';
import type { ReferenceRole, ReferenceSheetType } from '../video/types.js';
```

Add a handler (in the command dispatch switch, alongside existing `character-add` style handlers):

```typescript
async function handleReferenceSheetAdd(args: string[]): Promise<void> {
  const opts = parseArgs(args, {
    string: ['project', 'root', 'type', 'name', 'id', 'description', 'character-name'],
    array: ['ref', 'binding'],
  });
  const root = opts.root ?? process.cwd();
  const slug = requireOpt(opts, 'project');
  const type = requireOpt(opts, 'type') as ReferenceSheetType;
  const name = requireOpt(opts, 'name');

  if (!REFERENCE_SHEET_TYPES.includes(type)) {
    throw new Error(`unknown-sheet-type: ${type}. Expected one of: ${REFERENCE_SHEET_TYPES.join(', ')}`);
  }

  const artifact = await readReferenceSheetsArtifact(root, slug);
  const now = new Date();
  let sheet = createSheet({
    type,
    name,
    id: opts.id,
    description: opts.description,
    characterName: opts['character-name'],
    existingIds: artifact.sheets.map((s) => s.id),
    now,
  });

  for (const raw of opts.ref ?? []) {
    const [path, role, ...rest] = raw.split(':');
    if (!path || !role) throw new Error(`malformed --ref: ${raw}. Expected path:role[:note]`);
    if (!isRoleValidForType(role as ReferenceRole, type)) {
      throw new Error(
        `role-vocabulary-violation: role=${role} not valid for sheet-type=${type}. ` +
        `Allowed: ${ROLE_VOCABULARY[type].join(', ')}`,
      );
    }
    sheet = addReferenceToSheet(
      sheet,
      { path, role: role as ReferenceRole, note: rest.length > 0 ? rest.join(':') : undefined },
      now,
    );
  }

  const sceneIndices = (opts.binding ?? []).map((s) => Number(s));
  if (sceneIndices.length > 0) {
    sheet = bindSheetToScenes(sheet, sceneIndices, now);
  }

  const updated = upsertSheet(artifact, sheet);
  await writeReferenceSheetsArtifact(root, slug, updated);

  process.stdout.write(JSON.stringify({ sheet, summary: summarizeArtifact(updated) }, null, 2) + '\n');
}
```

Wire it into the command dispatch (add this case to the main `video` subcommand switch in the same file, in alphabetical-ish order near other `reference-*` / `readiness` handlers):

```typescript
case 'reference-sheet-add':
  await handleReferenceSheetAdd(rest);
  return;
```

And append the one-line usage to the `printHelp()` usage string (keep the existing style):

```
  vclaw video reference-sheet-add --project <slug> --type <type> --name <name> [--id <id>] [--description <text>] [--character-name <name>] [--ref <path>:<role> ...] [--binding <sceneIndex> ...] [--root <path>]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/cli-reference-sheets.test.js`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli/vclaw.ts src/tests/cli-reference-sheets.test.ts
git commit -m "Add reference-sheet-add CLI command"
```

---

### Task 6A: Extend `ReferenceEntry` to support Go Bananas references

**Files:**
- Modify: `src/video/types.ts`, `schemas/video/artifacts/reference-sheets.schema.json`, `src/video/reference-sheets.ts`, `src/cli/vclaw.ts`, `src/video/director-preflight.ts`
- Test: `src/tests/reference-sheets.test.ts`, `src/tests/cli-reference-sheets.test.ts` *(extend each)*

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/reference-sheets.test.ts`:

```typescript
test('ReferenceEntry supports the gbRef union variant', () => {
  const entry: ReferenceEntry = { gbRef: { kind: 'character', id: 247 }, role: 'identity' };
  assert.equal('gbRef' in entry ? entry.gbRef.kind : 'none', 'character');
});

test('validateSheet accepts a gbRef entry with a role valid for the sheet type', () => {
  const result = validateSheet({
    id: 's1', type: 'environment', name: 'Dusk', references: [{ gbRef: { kind: 'scene', id: 15 }, role: 'location' }],
    bindings: { sceneIndices: [0] }, createdAt: 'T', updatedAt: 'T',
  });
  assert.equal(result.ok, true);
});

test('validateSheet rejects a gbRef entry whose role is not in the sheet-type vocabulary', () => {
  const result = validateSheet({
    id: 's1', type: 'identity', name: 'X', references: [{ gbRef: { kind: 'character', id: 1 }, role: 'palette' }],
    bindings: { sceneIndices: [] }, createdAt: 'T', updatedAt: 'T',
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('|'), /role-vocabulary-violation/);
});
```

Append to `src/tests/cli-reference-sheets.test.ts`:

```typescript
test('reference-sheet-add accepts --gb-ref kind:id:role', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-gbref-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  const add = run([
    'video', 'reference-sheet-add',
    '--project', 'demo', '--root', root,
    '--type', 'environment', '--name', 'Dusk',
    '--gb-ref', 'scene:15:location',
    '--binding', '0',
  ]);
  assert.equal(add.status, 0, `stderr: ${add.stderr}`);
  const payload = JSON.parse(add.stdout);
  const ref = payload.sheet.references[0];
  assert.equal('gbRef' in ref ? ref.gbRef.kind : null, 'scene');
  assert.equal('gbRef' in ref ? ref.gbRef.id : null, 15);
  assert.equal(ref.role, 'location');
});

test('reference-sheet-add rejects --gb-ref with a role outside the sheet-type vocabulary', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-gbref-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  const add = run([
    'video', 'reference-sheet-add',
    '--project', 'demo', '--root', root,
    '--type', 'identity', '--name', 'Bad',
    '--gb-ref', 'character:1:palette',
  ]);
  assert.notEqual(add.status, 0);
  assert.match(add.stderr, /role-vocabulary-violation/);
});
```

- [ ] **Step 2: Update the types to a union**

Modify `src/video/types.ts`:

```typescript
export type GbRefKind = 'character' | 'product' | 'scene' | 'style-preset' | 'reference-group';

export interface GbRef {
  kind: GbRefKind;
  id: number;
}

export type ReferenceEntry =
  | { path: string; role: ReferenceRole; note?: string }
  | { gbRef: GbRef; role: ReferenceRole; note?: string };
```

Remove the old single-shape `ReferenceEntry` interface in favor of the union above.

- [ ] **Step 3: Update the JSON Schema**

Modify `schemas/video/artifacts/reference-sheets.schema.json`. Replace the `ReferenceEntry` definition with:

```json
"ReferenceEntry": {
  "oneOf": [
    {
      "type": "object",
      "required": ["path", "role"],
      "additionalProperties": false,
      "properties": {
        "path": { "type": "string", "minLength": 1 },
        "role": { "$ref": "#/definitions/ReferenceRole" },
        "note": { "type": "string" }
      }
    },
    {
      "type": "object",
      "required": ["gbRef", "role"],
      "additionalProperties": false,
      "properties": {
        "gbRef": {
          "type": "object",
          "required": ["kind", "id"],
          "additionalProperties": false,
          "properties": {
            "kind": { "enum": ["character", "product", "scene", "style-preset", "reference-group"] },
            "id": { "type": "integer", "minimum": 1 }
          }
        },
        "role": { "$ref": "#/definitions/ReferenceRole" },
        "note": { "type": "string" }
      }
    }
  ]
}
```

And lift the role enum into a `ReferenceRole` definition:

```json
"ReferenceRole": {
  "enum": [
    "identity", "wardrobe", "silhouette", "age-reference",
    "outfit", "material", "accessory", "texture",
    "product-hero", "product-variant", "product-in-use", "packaging",
    "location", "set-dressing", "weather", "time-of-day",
    "motion-rhythm", "camera-behavior", "blocking", "shot-framing",
    "palette", "composition", "mood", "lighting-reference"
  ]
}
```

Update the `ReferenceRole` type in `src/video/types.ts` to include the four new `product-*` roles.

Update `ROLE_VOCABULARY['outfit-material']` in `src/video/reference-sheets.ts`:

```typescript
'outfit-material': [
  'outfit', 'material', 'accessory', 'texture',
  'product-hero', 'product-variant', 'product-in-use', 'packaging',
],
```

- [ ] **Step 4: Add `--gb-ref` CLI parsing**

In `src/cli/vclaw.ts`, inside `handleReferenceSheetAdd`, add the `gb-ref` array to `parseArgs`:

```typescript
const opts = parseArgs(args, {
  string: ['project', 'root', 'type', 'name', 'id', 'description', 'character-name'],
  array: ['ref', 'binding', 'gb-ref'],
});
```

After the existing `for (const raw of opts.ref ?? [])` loop, add:

```typescript
for (const raw of opts['gb-ref'] ?? []) {
  const parts = raw.split(':');
  if (parts.length < 3) throw new Error(`malformed --gb-ref: ${raw}. Expected kind:id:role[:note]`);
  const [kind, idStr, role, ...noteParts] = parts;
  if (!['character', 'product', 'scene', 'style-preset', 'reference-group'].includes(kind)) {
    throw new Error(`unknown gb-ref kind: ${kind}`);
  }
  const id = Number(idStr);
  if (!Number.isInteger(id) || id < 1) throw new Error(`invalid gb-ref id: ${idStr}`);
  if (!isRoleValidForType(role as ReferenceRole, type)) {
    throw new Error(
      `role-vocabulary-violation: role=${role} not valid for sheet-type=${type}. ` +
      `Allowed: ${ROLE_VOCABULARY[type].join(', ')}`,
    );
  }
  sheet = addReferenceToSheet(
    sheet,
    {
      gbRef: { kind: kind as 'character' | 'product' | 'scene' | 'style-preset' | 'reference-group', id },
      role: role as ReferenceRole,
      note: noteParts.length > 0 ? noteParts.join(':') : undefined,
    },
    now,
  );
}
```

Update the help-text line for `reference-sheet-add` to include `[--gb-ref <kind>:<id>:<role> ...]`.

- [ ] **Step 5: Add GB-ref resolution to director preflight**

Modify `src/video/director-preflight.ts`. When `process.env.GO_BANANAS_API_KEY` is set, iterate over every sheet's references; for any `gbRef` entry, probe the corresponding GB endpoint (reuse the existing character-probe helper as the template for the other four kinds). Unresolved entities emit:

```typescript
issues.push({
  code: 'reference-sheet-orphan-gb-ref',
  severity: 'blocker',
  message: `sheet=${sheet.id} ref-index=${i}: gbRef ${entry.gbRef.kind}:${entry.gbRef.id} did not resolve`,
});
```

When `GO_BANANAS_API_KEY` is absent, skip GB resolution (do not fail). This matches today's character-probe behavior.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/reference-sheets.test.js dist/tests/cli-reference-sheets.test.js dist/tests/director-preflight.test.js`
Expected: all new tests pass; existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/video/types.ts schemas/video/artifacts/reference-sheets.schema.json src/video/reference-sheets.ts src/cli/vclaw.ts src/video/director-preflight.ts src/tests/reference-sheets.test.ts src/tests/cli-reference-sheets.test.ts
git commit -m "Extend ReferenceEntry with Go Bananas ref variant and product-* roles"
```

---

### Task 7: `reference-sheet-list` and `reference-sheet-show`

**Files:**
- Modify: `src/cli/vclaw.ts`
- Test: `src/tests/cli-reference-sheets.test.ts` *(extend)*

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/cli-reference-sheets.test.ts`:

```typescript
test('reference-sheet-list returns all sheets and can filter by type', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'identity', '--name', 'Lead', '--ref', 'refs/a.png:identity']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'Dusk', '--ref', 'refs/b.png:palette']).status, 0);

  const all = run(['video', 'reference-sheet-list', '--project', 'demo', '--root', root]);
  assert.equal(all.status, 0);
  const allPayload = JSON.parse(all.stdout);
  assert.equal(allPayload.sheets.length, 2);

  const filtered = run(['video', 'reference-sheet-list', '--project', 'demo', '--root', root, '--type', 'identity']);
  assert.equal(filtered.status, 0);
  const filteredPayload = JSON.parse(filtered.stdout);
  assert.equal(filteredPayload.sheets.length, 1);
  assert.equal(filteredPayload.sheets[0].type, 'identity');
});

test('reference-sheet-show returns a single sheet by id', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'identity', '--name', 'Lead', '--id', 'lead-v1', '--ref', 'refs/a.png:identity']).status, 0);

  const show = run(['video', 'reference-sheet-show', '--project', 'demo', '--root', root, '--id', 'lead-v1']);
  assert.equal(show.status, 0);
  const payload = JSON.parse(show.stdout);
  assert.equal(payload.sheet.id, 'lead-v1');
});

test('reference-sheet-show fails for unknown id', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);

  const show = run(['video', 'reference-sheet-show', '--project', 'demo', '--root', root, '--id', 'nope']);
  assert.notEqual(show.status, 0);
  assert.match(show.stderr, /unknown sheet/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test dist/tests/cli-reference-sheets.test.js`
Expected: FAIL — `reference-sheet-list` unknown.

- [ ] **Step 3: Implement the handlers**

Add to `src/cli/vclaw.ts`:

```typescript
async function handleReferenceSheetList(args: string[]): Promise<void> {
  const opts = parseArgs(args, { string: ['project', 'root', 'type'] });
  const root = opts.root ?? process.cwd();
  const slug = requireOpt(opts, 'project');
  const artifact = await readReferenceSheetsArtifact(root, slug);
  const filtered = opts.type
    ? artifact.sheets.filter((s) => s.type === opts.type)
    : artifact.sheets;
  process.stdout.write(JSON.stringify({
    sheets: filtered,
    summary: summarizeArtifact(artifact),
  }, null, 2) + '\n');
}

async function handleReferenceSheetShow(args: string[]): Promise<void> {
  const opts = parseArgs(args, { string: ['project', 'root', 'id'] });
  const root = opts.root ?? process.cwd();
  const slug = requireOpt(opts, 'project');
  const id = requireOpt(opts, 'id');
  const artifact = await readReferenceSheetsArtifact(root, slug);
  const sheet = findSheet(artifact, id);
  if (!sheet) throw new Error(`unknown sheet: ${id}`);
  process.stdout.write(JSON.stringify({ sheet }, null, 2) + '\n');
}
```

Wire the cases:

```typescript
case 'reference-sheet-list':
  await handleReferenceSheetList(rest);
  return;
case 'reference-sheet-show':
  await handleReferenceSheetShow(rest);
  return;
```

Append to `printHelp()`:

```
  vclaw video reference-sheet-list --project <slug> [--type <sheet-type>] [--root <path>]
  vclaw video reference-sheet-show --project <slug> --id <sheet-id> [--root <path>]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/cli-reference-sheets.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/cli/vclaw.ts src/tests/cli-reference-sheets.test.ts
git commit -m "Add reference-sheet-list and reference-sheet-show CLI commands"
```

---

### Task 8: `reference-sheet-bind`

**Files:**
- Modify: `src/cli/vclaw.ts`
- Test: `src/tests/cli-reference-sheets.test.ts` *(extend)*

- [ ] **Step 1: Write the failing test**

Append:

```typescript
test('reference-sheet-bind adds scene indices idempotently', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'identity', '--name', 'Lead', '--id', 'lead', '--ref', 'refs/a.png:identity']).status, 0);

  const bind1 = run(['video', 'reference-sheet-bind', '--project', 'demo', '--root', root, '--id', 'lead', '--scene', '0', '--scene', '2']);
  assert.equal(bind1.status, 0);
  assert.deepEqual(JSON.parse(bind1.stdout).sheet.bindings.sceneIndices, [0, 2]);

  // Idempotent: binding the same scenes again should not duplicate.
  const bind2 = run(['video', 'reference-sheet-bind', '--project', 'demo', '--root', root, '--id', 'lead', '--scene', '2', '--scene', '3']);
  assert.equal(bind2.status, 0);
  assert.deepEqual(JSON.parse(bind2.stdout).sheet.bindings.sceneIndices, [0, 2, 3]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/cli-reference-sheets.test.js`

- [ ] **Step 3: Implement the handler**

Add to `src/cli/vclaw.ts`:

```typescript
async function handleReferenceSheetBind(args: string[]): Promise<void> {
  const opts = parseArgs(args, { string: ['project', 'root', 'id'], array: ['scene'] });
  const root = opts.root ?? process.cwd();
  const slug = requireOpt(opts, 'project');
  const id = requireOpt(opts, 'id');
  const sceneIndices = (opts.scene ?? []).map((s) => Number(s));

  const artifact = await readReferenceSheetsArtifact(root, slug);
  const sheet = findSheet(artifact, id);
  if (!sheet) throw new Error(`unknown sheet: ${id}`);

  const now = new Date();
  const updatedSheet = bindSheetToScenes(sheet, sceneIndices, now);
  const updated = upsertSheet(artifact, updatedSheet);
  await writeReferenceSheetsArtifact(root, slug, updated);

  process.stdout.write(JSON.stringify({ sheet: updatedSheet }, null, 2) + '\n');
}
```

Wire:

```typescript
case 'reference-sheet-bind':
  await handleReferenceSheetBind(rest);
  return;
```

Help:

```
  vclaw video reference-sheet-bind --project <slug> --id <sheet-id> --scene <sceneIndex> [--scene <sceneIndex> ...] [--root <path>]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/cli-reference-sheets.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/cli/vclaw.ts src/tests/cli-reference-sheets.test.ts
git commit -m "Add reference-sheet-bind CLI command"
```

---

### Task 9: `reference-sheet-validate`

**Files:**
- Modify: `src/cli/vclaw.ts`
- Test: `src/tests/cli-reference-sheets.test.ts` *(extend)*

- [ ] **Step 1: Write the failing tests**

Append:

```typescript
import { writeFileSync, mkdirSync } from 'node:fs';

test('reference-sheet-validate reports collisions on the same scene', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'A', '--id', 'a', '--ref', 'refs/a.png:palette', '--binding', '1']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'B', '--id', 'b', '--ref', 'refs/b.png:palette', '--binding', '1']).status, 0);

  const res = run(['video', 'reference-sheet-validate', '--project', 'demo', '--root', root]);
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.collisions.length, 1);
  assert.equal(payload.collisions[0].role, 'palette');
  assert.equal(payload.collisions[0].sceneIndex, 1);
});

test('reference-sheet-validate reports ok on clean artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-cli-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'identity', '--name', 'Lead', '--ref', 'refs/a.png:identity', '--binding', '0']).status, 0);

  const res = run(['video', 'reference-sheet-validate', '--project', 'demo', '--root', root]);
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.errors, []);
  assert.deepEqual(payload.collisions, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test dist/tests/cli-reference-sheets.test.js`

- [ ] **Step 3: Implement the handler**

Add to `src/cli/vclaw.ts`:

```typescript
async function handleReferenceSheetValidate(args: string[]): Promise<void> {
  const opts = parseArgs(args, { string: ['project', 'root'] });
  const root = opts.root ?? process.cwd();
  const slug = requireOpt(opts, 'project');
  const artifact = await readReferenceSheetsArtifact(root, slug);
  const validation = validateArtifact(artifact);
  const collisions = findRoleCollisions(artifact);
  const ok = validation.ok && collisions.length === 0;
  process.stdout.write(JSON.stringify({
    ok,
    errors: validation.errors,
    collisions,
    summary: summarizeArtifact(artifact),
  }, null, 2) + '\n');
}
```

Wire:

```typescript
case 'reference-sheet-validate':
  await handleReferenceSheetValidate(rest);
  return;
```

Help:

```
  vclaw video reference-sheet-validate --project <slug> [--root <path>]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/cli-reference-sheets.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/cli/vclaw.ts src/tests/cli-reference-sheets.test.ts
git commit -m "Add reference-sheet-validate CLI command"
```

---

## Phase 4 — Readiness + preflight integration

### Task 10: Readiness — require Identity Sheet for character-bound scenes

**Files:**
- Modify: `src/video/readiness.ts`
- Test: `src/tests/readiness.test.ts` *(extend)*

- [ ] **Step 1: Inspect the existing readiness API**

Run: `grep -n "export" src/video/readiness.ts | head -20`
Expected: locate `buildProjectReadiness` or equivalent.

- [ ] **Step 2: Write the failing test**

Append a new test to `src/tests/readiness.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
function run(args: string[]) {
  return spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
}

test('director-mode readiness fails when a character-bound scene has no Identity Sheet', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-readiness-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'brief', '--project', 'demo', '--root', root, '--title', 'T', '--intent', 'intent']).status, 0);
  assert.equal(run(['video', 'character-add', '--project', 'demo', '--root', root, '--name', 'Mochi']).status, 0);
  assert.equal(run(['video', 'storyboard', '--project', 'demo', '--root', root, '--scene', 'open', '--scene-character', '0:Mochi']).status, 0);

  const res = run(['video', 'readiness', '--project', 'demo', '--root', root, '--mode', 'director']);
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.ready, false);
  const codes = (payload.blockers ?? []).map((b: { code: string }) => b.code);
  assert(codes.includes('reference-sheet-missing-identity'), `expected missing-identity blocker, got: ${codes.join(',')}`);
});

test('director-mode readiness passes when every character-bound scene has an Identity Sheet', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-readiness-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'brief', '--project', 'demo', '--root', root, '--title', 'T', '--intent', 'intent']).status, 0);
  assert.equal(run(['video', 'character-add', '--project', 'demo', '--root', root, '--name', 'Mochi', '--ref', 'refs/mochi.png']).status, 0);
  assert.equal(run(['video', 'storyboard', '--project', 'demo', '--root', root, '--scene', 'open', '--scene-character', '0:Mochi']).status, 0);
  assert.equal(run([
    'video', 'reference-sheet-add',
    '--project', 'demo', '--root', root,
    '--type', 'identity', '--name', 'Lead',
    '--character-name', 'Mochi',
    '--ref', 'refs/mochi.png:identity',
    '--binding', '0',
  ]).status, 0);

  const res = run(['video', 'readiness', '--project', 'demo', '--root', root, '--mode', 'director']);
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  const blockerCodes = (payload.blockers ?? []).map((b: { code: string }) => b.code);
  assert(!blockerCodes.includes('reference-sheet-missing-identity'),
    `unexpected missing-identity blocker, got: ${blockerCodes.join(',')}`);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/readiness.test.js`
Expected: FAIL — blocker not present because logic doesn't exist yet.

- [ ] **Step 4: Implement the readiness hook**

Modify `src/video/readiness.ts`. Import at the top:

```typescript
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import { sheetsCoveringScene } from './reference-sheets.js';
```

In `buildProjectReadiness` (or the equivalent async builder), after character-consistency is assembled and before returning, insert:

```typescript
// Reference-sheet readiness (director-mode only): any scene that binds at least one
// character must be covered by at least one Identity Sheet.
if (mode === 'director' && storyboard?.scenes) {
  const sheetsArtifact = await readReferenceSheetsArtifact(root, slug);
  for (const [i, scene] of storyboard.scenes.entries()) {
    if (!scene.characters || scene.characters.length === 0) continue;
    const covering = sheetsCoveringScene(sheetsArtifact, i);
    const hasIdentity = covering.some((s) => s.type === 'identity');
    if (!hasIdentity) {
      blockers.push({
        code: 'reference-sheet-missing-identity',
        severity: 'blocker',
        message: `scene ${i} has character bindings but no Identity Sheet is bound to it`,
        sceneIndex: i,
      });
    }
  }
}
```

(Adjust field names to match the existing blocker shape in `readiness.ts` — this matches the `{ code, severity, message }` pattern already used.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/readiness.test.js`

- [ ] **Step 6: Commit**

```bash
git add src/video/readiness.ts src/tests/readiness.test.ts
git commit -m "Require Identity Sheet per character-bound scene in director-mode readiness"
```

---

### Task 11: Director preflight — three new checks

**Files:**
- Modify: `src/video/director-preflight.ts`
- Test: `src/tests/director-preflight.test.ts` *(extend)*

- [ ] **Step 1: Write the failing test**

Append to `src/tests/director-preflight.test.ts`:

```typescript
test('director-preflight flags role-collision when two sheets supply the same role on one scene', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-preflight-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'brief', '--project', 'demo', '--root', root, '--title', 'T', '--intent', 'x']).status, 0);
  assert.equal(run(['video', 'storyboard', '--project', 'demo', '--root', root, '--scene', 'a', '--scene', 'b']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'A', '--id', 'a', '--ref', 'refs/a.png:palette', '--binding', '1']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'B', '--id', 'b', '--ref', 'refs/b.png:palette', '--binding', '1']).status, 0);

  const res = run(['video', 'director-preflight', '--project', 'demo', '--root', root]);
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  const codes = (payload.issues ?? []).map((i: { code: string }) => i.code);
  assert(codes.includes('role-collision'), `expected role-collision, got: ${codes.join(',')}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/director-preflight.test.js`

- [ ] **Step 3: Implement the preflight integration**

Modify `src/video/director-preflight.ts`. Import at the top:

```typescript
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import { findRoleCollisions, validateArtifact } from './reference-sheets.js';
```

Inside `runDirectorPreflight` (or equivalent), after existing checks and before returning, add:

```typescript
const sheets = await readReferenceSheetsArtifact(root, slug);
const validation = validateArtifact(sheets);
for (const err of validation.errors) {
  if (err.startsWith('role-vocabulary-violation')) {
    issues.push({ code: 'role-vocabulary-violation', severity: 'blocker', message: err });
  } else if (err.startsWith('unassigned-role')) {
    issues.push({ code: 'unassigned-role', severity: 'blocker', message: err });
  } else {
    issues.push({ code: 'reference-sheet-invalid', severity: 'blocker', message: err });
  }
}
for (const c of findRoleCollisions(sheets)) {
  issues.push({
    code: 'role-collision',
    severity: 'blocker',
    message: `scene ${c.sceneIndex}: role=${c.role} supplied by sheets ${c.sheetIds.join(', ')}`,
    sceneIndex: c.sceneIndex,
  });
}
```

(Adjust issue shape to match the existing preflight issue record — reuse the existing `{ code, severity, message, sceneIndex? }` pattern.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/director-preflight.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/video/director-preflight.ts src/tests/director-preflight.test.ts
git commit -m "Add reference-sheet preflight checks (unassigned-role, vocab-violation, collision)"
```

---

## Phase 5 — Ops surfaces

### Task 12: Status + project-index expose `referenceSheets` summary

**Files:**
- Modify: `src/video/status.ts`, `src/video/project-index.ts`
- Test: `src/tests/status.test.ts`, `src/tests/project-index.test.ts` *(extend each)*

- [ ] **Step 1: Write the failing tests**

Append to `src/tests/status.test.ts`:

```typescript
test('status exposes referenceSheets summary when sheets exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-status-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'identity', '--name', 'Lead', '--ref', 'refs/a.png:identity', '--binding', '0']).status, 0);

  const res = run(['video', 'status', '--project', 'demo', '--root', root, '--mode', 'director']);
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.equal(payload.referenceSheets.count, 1);
  assert.equal(payload.referenceSheets.byType.identity, 1);
  assert.equal(payload.referenceSheets.boundSceneCount, 1);
  assert.deepEqual(payload.referenceSheets.unboundSheetIds, []);
});
```

Append an equivalent test to `src/tests/project-index.test.ts` that checks `payload.projects[0].referenceSheets` after `vclaw video index`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test dist/tests/status.test.js dist/tests/project-index.test.js`

- [ ] **Step 3: Implement**

In `src/video/status.ts`, at the top import:

```typescript
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import { summarizeArtifact } from './reference-sheets.js';
```

Inside the status-builder function, after existing fields, add to the returned object:

```typescript
referenceSheets: summarizeArtifact(await readReferenceSheetsArtifact(root, slug)),
```

In `src/video/project-index.ts`, do the same inside the per-project loop.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/status.test.js dist/tests/project-index.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/video/status.ts src/video/project-index.ts src/tests/status.test.ts src/tests/project-index.test.ts
git commit -m "Surface referenceSheets summary in status and project-index"
```

---

### Task 13: Report, CSV export, Obsidian export

**Files:**
- Modify: `src/video/report.ts`, `src/video/csv-export.ts`, `src/video/obsidian-export.ts`
- Test: `src/tests/report.test.ts`, `src/tests/cli-report-csv.test.ts`, `src/tests/cli-obsidian-export.test.ts` *(extend)*

- [ ] **Step 1: Write the failing tests**

In `src/tests/report.test.ts`, add a test that builds a portfolio report and asserts `payload.projects[0].referenceSheets.count === 1` after creating a project with one sheet.

In `src/tests/cli-report-csv.test.ts`, add a test that asserts the generated `projects.csv` contains a `reference_sheets_count` column and a value of `1`.

In `src/tests/cli-obsidian-export.test.ts`, add a test that asserts the generated project note frontmatter includes `referenceSheetCount: 1`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && node --test dist/tests/report.test.js dist/tests/cli-report-csv.test.js dist/tests/cli-obsidian-export.test.js`

- [ ] **Step 3: Implement**

In `src/video/report.ts`: read `summarizeArtifact(await readReferenceSheetsArtifact(root, slug))` for each project and attach as `project.referenceSheets`.

In `src/video/csv-export.ts`: add columns `reference_sheets_count` and `reference_sheets_types` (pipe-separated) to the projects CSV writer.

In `src/video/obsidian-export.ts`: add three frontmatter fields to the per-project note:
- `referenceSheetCount`
- `referenceSheetTypes` (comma-separated)
- `referenceSheetCollisions` (boolean — true if `findRoleCollisions(artifact).length > 0`)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test dist/tests/report.test.js dist/tests/cli-report-csv.test.js dist/tests/cli-obsidian-export.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/video/report.ts src/video/csv-export.ts src/video/obsidian-export.ts src/tests/
git commit -m "Propagate referenceSheets summary through report, CSV, and Obsidian export"
```

---

### Task 14: Storyboard markdown review includes a Reference sheets section

**Files:**
- Modify: `src/video/storyboard-markdown.ts`
- Test: `src/tests/storyboard-markdown.test.ts` *(extend)*

- [ ] **Step 1: Write the failing test**

Append to `src/tests/storyboard-markdown.test.ts`:

```typescript
test('storyboard.md review includes a Reference sheets section when sheets exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-storyboard-md-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'brief', '--project', 'demo', '--root', root, '--title', 'T', '--intent', 'x']).status, 0);
  assert.equal(run(['video', 'storyboard', '--project', 'demo', '--root', root, '--scene', 'open']).status, 0);
  assert.equal(run([
    'video', 'reference-sheet-add',
    '--project', 'demo', '--root', root,
    '--type', 'palette-mood', '--name', 'Dusk',
    '--ref', 'refs/dusk.png:palette',
    '--binding', '0',
  ]).status, 0);
  assert.equal(run(['video', 'storyboard-review', '--project', 'demo', '--root', root, '--mode', 'director']).status, 0);

  const md = readFileSync(join(root, 'projects', 'demo', 'storyboard.md'), 'utf8');
  assert.match(md, /Reference sheets/i);
  assert.match(md, /Dusk/);
  assert.match(md, /palette/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/storyboard-markdown.test.js`

- [ ] **Step 3: Implement the section**

In `src/video/storyboard-markdown.ts`, import:

```typescript
import { readReferenceSheetsArtifact } from './reference-sheet-store.js';
import { sheetsCoveringScene } from './reference-sheets.js';
```

In `writeStoryboardMarkdownReview` / `buildStoryboardMarkdown`, after the existing character binding section, append:

```typescript
const sheets = await readReferenceSheetsArtifact(root, slug);
if (sheets.sheets.length > 0) {
  lines.push('', '## Reference sheets', '');
  lines.push('| Scene | Sheet | Type | Role(s) | Character |');
  lines.push('|---|---|---|---|---|');
  for (const [i, scene] of storyboard.scenes.entries()) {
    const covering = sheetsCoveringScene(sheets, i);
    for (const sheet of covering) {
      const roles = sheet.references.map((r) => r.role).join(', ') || '—';
      lines.push(`| ${i} | ${sheet.name} (${sheet.id}) | ${sheet.type} | ${roles} | ${sheet.characterName ?? '—'} |`);
    }
  }
  lines.push('');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/storyboard-markdown.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/video/storyboard-markdown.ts src/tests/storyboard-markdown.test.ts
git commit -m "Add Reference sheets section to director-mode storyboard review"
```

---

## Phase 6 — Doctor

### Task 15: Doctor + doctor-portfolio include sheet diagnostics

**Files:**
- Modify: `src/video/doctor.ts`, `src/video/doctor-portfolio.ts`
- Test: `src/tests/doctor.test.ts` (or `cli-doctor-portfolio.test.ts`) *(extend)*

- [ ] **Step 1: Write the failing test**

Append to `src/tests/cli-doctor-portfolio.test.ts`:

```typescript
test('doctor-portfolio counts projects with reference-sheet collisions', () => {
  const root = mkdtempSync(join(tmpdir(), 'vclaw-doctor-portfolio-refsheet-'));
  assert.equal(run(['video', 'init', 'demo', '--root', root, '--mode', 'director']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'A', '--ref', 'refs/a.png:palette', '--binding', '0']).status, 0);
  assert.equal(run(['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'palette-mood', '--name', 'B', '--ref', 'refs/b.png:palette', '--binding', '0']).status, 0);

  const res = run(['video', 'doctor-portfolio', '--root', root, '--mode', 'director']);
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.ok(payload.referenceSheets, 'expected referenceSheets summary');
  assert.equal(payload.referenceSheets.projectsWithCollisions, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/tests/cli-doctor-portfolio.test.js`

- [ ] **Step 3: Implement doctor integration**

In `src/video/doctor.ts`, add a per-project check producing findings with codes:
- `reference-sheet-missing-identity-when-awaiting-approval`
- `reference-sheet-role-collision`
- `reference-sheet-unassigned-role`

In `src/video/doctor-portfolio.ts`, aggregate across all projects and add to the output:

```typescript
referenceSheets: {
  projectsWithSheets: <count>,
  projectsWithCollisions: <count>,
  projectsWithUnassignedRoles: <count>,
  projectsWithoutIdentityWhenApprovalPending: <count>,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/tests/cli-doctor-portfolio.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/video/doctor.ts src/video/doctor-portfolio.ts src/tests/
git commit -m "Add reference-sheet diagnostics to doctor and doctor-portfolio"
```

---

## Phase 7 — Public API, smoke, docs

### Task 16: Re-exports from the public library surface

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add re-exports**

Append to `src/index.ts`:

```typescript
export {
  ROLE_VOCABULARY,
  REFERENCE_SHEET_TYPES,
  addReferenceToSheet,
  bindSheetToScenes,
  createSheet,
  findRoleCollisions,
  findSheet,
  isRoleValidForType,
  removeSheet,
  sheetsCoveringScene,
  summarizeArtifact,
  upsertSheet,
  validateArtifact,
  validateSheet,
} from './video/reference-sheets.js';

export {
  readReferenceSheetsArtifact,
  writeReferenceSheetsArtifact,
  referenceSheetsPathFor,
} from './video/reference-sheet-store.js';

export type {
  ReferenceEntry,
  ReferenceRole,
  ReferenceSheet,
  ReferenceSheetBindings,
  ReferenceSheetType,
  ReferenceSheetsArtifact,
} from './video/types.js';
```

- [ ] **Step 2: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: clean build, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "Re-export reference-sheet public surface from src/index.ts"
```

---

### Task 17: Smoke script

**Files:**
- Create: `scripts/smoke-reference-sheets.mjs`
- Modify: `package.json`, `scripts/check-release-readiness-lite.sh`

- [ ] **Step 1: Create the smoke script**

Create `scripts/smoke-reference-sheets.mjs`:

```javascript
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function runCLI(args) {
  return execFileSync('node', [CLI, ...args], { encoding: 'utf8' });
}

const root = mkdtempSync(join(tmpdir(), 'smoke-reference-sheets-'));

runCLI(['video', 'init', 'demo', '--root', root, '--mode', 'director']);
runCLI(['video', 'brief', '--project', 'demo', '--root', root, '--title', 'Smoke', '--intent', 'verify reference sheets end-to-end']);
runCLI(['video', 'character-add', '--project', 'demo', '--root', root, '--name', 'Mochi', '--ref', 'refs/mochi.png']);
runCLI(['video', 'storyboard', '--project', 'demo', '--root', root, '--scene', 'open', '--scene-character', '0:Mochi']);

runCLI([
  'video', 'reference-sheet-add',
  '--project', 'demo', '--root', root,
  '--type', 'identity', '--name', 'Lead',
  '--character-name', 'Mochi',
  '--ref', 'refs/mochi-identity.png:identity',
  '--binding', '0',
]);

runCLI([
  'video', 'reference-sheet-add',
  '--project', 'demo', '--root', root,
  '--type', 'palette-mood', '--name', 'Dusk',
  '--ref', 'refs/dusk.png:palette',
  '--binding', '0',
]);

const listOut = JSON.parse(runCLI(['video', 'reference-sheet-list', '--project', 'demo', '--root', root]));
if (listOut.sheets.length !== 2) throw new Error(`expected 2 sheets, got ${listOut.sheets.length}`);

const validateOut = JSON.parse(runCLI(['video', 'reference-sheet-validate', '--project', 'demo', '--root', root]));
if (!validateOut.ok) throw new Error(`validation failed: ${JSON.stringify(validateOut.errors)}`);

const readiness = JSON.parse(runCLI(['video', 'readiness', '--project', 'demo', '--root', root, '--mode', 'director']));
const blockerCodes = (readiness.blockers ?? []).map((b) => b.code);
if (blockerCodes.includes('reference-sheet-missing-identity')) {
  throw new Error(`unexpected missing-identity blocker: ${blockerCodes.join(',')}`);
}

runCLI(['video', 'storyboard-review', '--project', 'demo', '--root', root, '--mode', 'director']);
const mdPath = join(root, 'projects', 'demo', 'storyboard.md');
if (!existsSync(mdPath)) throw new Error('storyboard.md was not generated');
const md = readFileSync(mdPath, 'utf8');
if (!md.includes('Reference sheets')) throw new Error('storyboard.md is missing the Reference sheets section');
if (!md.includes('Dusk')) throw new Error('storyboard.md is missing the Dusk palette sheet');

console.log('smoke-reference-sheets: OK');
```

- [ ] **Step 2: Add the npm script**

Modify `package.json` — add to the `scripts` block:

```json
"smoke:reference-sheets": "npm run build && node scripts/smoke-reference-sheets.mjs",
```

- [ ] **Step 3: Wire into release-readiness-lite**

Modify `scripts/check-release-readiness-lite.sh` — add the smoke after `node scripts/smoke-portfolio.mjs`:

```bash
node scripts/smoke-reference-sheets.mjs
```

- [ ] **Step 4: Run the smoke directly**

Run: `npm run smoke:reference-sheets`
Expected: prints `smoke-reference-sheets: OK` and exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-reference-sheets.mjs scripts/check-release-readiness-lite.sh package.json
git commit -m "Wire reference-sheets smoke into release-readiness-lite"
```

---

### Task 18: Operator documentation

**Files:**
- Create: `docs/REFERENCE_SHEETS.md`
- Modify: `README.md`, `docs/CLI_REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/MASTER_PLAN_ALIGNMENT.md`

- [ ] **Step 1: Create `docs/REFERENCE_SHEETS.md`**

Write a full operator guide covering:

1. What reference sheets are and why they exist (Seedance handbook rationale)
2. The 5 sheet types and their role vocabularies (copy the table from the spec)
3. Setup — creating the first sheet
4. The 5 CLI commands, each with a full example invocation and JSON output sample
5. Readiness and preflight semantics (what triggers `reference-sheet-missing-identity`, what the three validation checks do)
6. Integration with existing subsystems (characters, director-mode review, Obsidian export)
7. Common workflows:
   - *"I want to lock identity for one character across 4 scenes"*
   - *"I want a single palette/mood sheet bound to the first half of the video"*
   - *"I hit a role-collision — what do I do?"*
8. Troubleshooting (map to the handbook's troubleshooting-by-symptom matrix)

- [ ] **Step 2: Add to `docs/CLI_REFERENCE.md`**

Under the Character subsystem section, add a new "Reference sheets" subsection listing the 5 new commands with the same shape as existing entries.

- [ ] **Step 3: Update `docs/ARCHITECTURE.md`**

Add a bullet to the "Current implemented flow" list:

```
20. `video reference-sheet-add|list|show|bind|validate`
    - role-tagged reference sheets with closed-vocabulary validation and per-scene binding
```

- [ ] **Step 4: Update `docs/MASTER_PLAN_ALIGNMENT.md`**

Add a new top-level implemented item:

```
54. Reference sheets subsystem:
    - five sheet types (identity, outfit-material, environment, motion-camera, palette-mood) with closed role vocabularies
    - role-tagged references with per-scene bindings
    - five CLI commands (reference-sheet-add / list / show / bind / validate)
    - readiness gate on identity coverage for character-bound scenes in director-mode
    - director-preflight checks: unassigned-role, role-vocabulary-violation, role-collision
    - ops-surface integration: status, project-index, report, CSV export, Obsidian export, doctor, doctor-portfolio
    - Reference sheets section in director-mode storyboard.md review
    - packaged smoke coverage via scripts/smoke-reference-sheets.mjs
```

- [ ] **Step 5: Update `README.md`**

Add a short sentence to the "What's shipped" themes block:

```
- **Reference sheets** — role-tagged generator inputs (identity / wardrobe / palette / motion / environment) with readiness, preflight, and ops-surface integration.
```

Add `docs/REFERENCE_SHEETS.md` to the Documentation map table.

- [ ] **Step 6: Commit**

```bash
git add docs/REFERENCE_SHEETS.md docs/CLI_REFERENCE.md docs/ARCHITECTURE.md docs/MASTER_PLAN_ALIGNMENT.md README.md
git commit -m "Document reference sheets feature"
```

---

### Task 19: Final verification + push

**Files:** *(none — runs the full pre-flight)*

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: green.

- [ ] **Step 2: Run the full release-readiness check**

Run: `npm run check:release-readiness-lite`
Expected: green (includes the new reference-sheets smoke).

- [ ] **Step 3: Verify the cleanroom-docs guardrail**

Run: `npm run check:cleanroom-docs`
Expected: green.

- [ ] **Step 4: Push**

Run: `git push`
Expected: CI workflow runs on GitHub; the badge stays green.

- [ ] **Step 5: Confirm CI is green**

Open: https://github.com/davendra/vclaw-video-core/actions/workflows/ci.yml
Expected: the latest run on `codex/core-visibility-savepoint` is green.

---

## Self-review

1. **Spec coverage**
   - Problem section → Tasks 10, 11 (readiness + preflight enforcement) address the "role-less references reach provider" problem.
   - Data model → Tasks 1–3 (schema, types, mutation primitives).
   - CLI surface → Tasks 6–9 (all 5 commands).
   - Integration points — readiness → Task 10. Preflight → Task 11. Doctor → Task 15. Status/index/report/CSV/Obsidian → Tasks 12, 13. Storyboard markdown → Task 14.
   - Non-goals honored — no auto-generation, no sheet-template library, no visual previews, no retroactive migration.
   - Testing strategy → covered: module contracts (Tasks 2–4), store round-trip (Task 5), CLI E2E (Tasks 6–9), smoke (Task 17).
   - Backwards compat → the readiness tightening is the only breaking change and is called out in Task 10 test expectations; existing projects without sheets remain unaffected.
   - Documentation → Task 18.
   - Shipping checklist → Task 19.

2. **Placeholder scan** — no TBDs, no "add appropriate error handling", every step that touches code shows the code. A few steps for extending existing files (status, project-index, CSV, Obsidian) say "match existing pattern" but that's an intentional pointer to a concrete adjacent piece of code, not a placeholder.

3. **Type consistency** — `createSheet`, `addReferenceToSheet`, `bindSheetToScenes`, `findSheet`, `removeSheet`, `upsertSheet`, `summarizeArtifact`, `findRoleCollisions`, `sheetsCoveringScene`, `isRoleValidForType`, `validateSheet`, `validateArtifact`, `readReferenceSheetsArtifact`, `writeReferenceSheetsArtifact`, `referenceSheetsPathFor` — all spelled consistently across tasks. Types (`ReferenceSheet`, `ReferenceSheetType`, `ReferenceRole`, `ReferenceEntry`, `ReferenceSheetBindings`, `ReferenceSheetsArtifact`) likewise consistent.
