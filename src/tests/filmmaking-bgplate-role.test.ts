import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  FilmmakingPromptsArtifact,
  FilmmakingReferenceSlot,
} from '../video/filmmaking-prompts.js';

// WS7 / Task 7.1: 'background-plate' is a valid FilmmakingReferenceSlot.role.
// The slot must type-check and round-trip through the canonical artifact shape
// (i.e. validate against the filmmaking-prompts JSON Schema, whose role enum is
// strict and whose objects are additionalProperties:false).

const schemaPath = fileURLToPath(
  new URL('../../schemas/video/artifacts/filmmaking-prompts.schema.json', import.meta.url),
);

describe('WS7 background-plate reference role', () => {
  it('type-checks a slot whose role is background-plate', () => {
    const slot: FilmmakingReferenceSlot = {
      slot: '@image1',
      role: 'background-plate',
      label: 'Warehouse interior background plate',
      path: 'assets/plates/warehouse.jpg',
      sceneIndex: 0,
      status: 'ready',
    };
    assert.equal(slot.role, 'background-plate');
  });

  it('round-trips a background-plate slot through the artifact JSON Schema role enum', async () => {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as {
      $defs: { referenceSlot: { properties: { role: { enum: string[] } } } };
    };
    const roleEnum = schema.$defs.referenceSlot.properties.role.enum;
    assert.ok(
      roleEnum.includes('background-plate'),
      `expected filmmaking-prompts schema role enum to include background-plate, got ${roleEnum.join(', ')}`,
    );
  });

  it('keeps a background-plate slot in a FilmmakingPromptsArtifact referenceMap', () => {
    const artifact: FilmmakingPromptsArtifact = {
      schemaVersion: 1,
      projectSlug: 'bgplate-probe',
      generatedAt: '2026-05-30T00:00:00.000Z',
      sourceSkill: 'ai-filmmaking',
      durationDefaultSeconds: 15,
      referenceMap: [
        {
          slot: '@image1',
          role: 'background-plate',
          label: 'Rooftop background plate',
          status: 'pending',
        },
      ],
      characterSheetPrompts: [],
      storyboardGridPrompt: null,
      seedancePackets: [],
      issues: [],
    };
    const roundTripped = JSON.parse(JSON.stringify(artifact)) as FilmmakingPromptsArtifact;
    assert.equal(roundTripped.referenceMap[0]?.role, 'background-plate');
  });
});
