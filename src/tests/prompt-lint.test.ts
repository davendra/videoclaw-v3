import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintFilmmakingPrompts, type PromptLintIssue } from '../video/prompt-lint.js';
import type {
  FilmmakingPromptsArtifact,
  FilmmakingSeedancePacket,
} from '../video/filmmaking-prompts.js';

function hasCode(issues: PromptLintIssue[], code: PromptLintIssue['code']): boolean {
  return issues.some((issue: PromptLintIssue) => issue.code === code);
}

// A well-formed text-driven packet body covering every block the linter checks.
// Word count is padded into the 280-600 window so the clean case has zero issues.
function cleanBody(): string {
  const filler = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
  return [
    'SCENE & MOOD: nine seconds cinematic grounded realism at 16:9. A lone figure crosses a rain-slick courtyard.',
    'FRAME MAP:',
    '  0:00-0:03: Wide establishing shot',
    'SUBJECT LOCK: preserve the primary subject identical across every frame.',
    'CROSS-FRAME RULES: face, hair, wardrobe, silhouette, palette stay identical.',
    'MOVEMENT: Shot 1 (0:00-0:03): master, eye-level angle, dolly — the action. Hard cut to Shot 2 (0:03-0:06): master, eye-level angle, dolly — develops.',
    'LAST FRAME: resolved final beat. No on-screen text.',
    'WORLD PLATE: a rain-slick courtyard.',
    'SOUND BED: No music. Natural ambience and subject-driven sound only.',
    'CAPTURE REALISM: anti-plastic capture treatment with believable skin texture.',
    'CAMERA CAPTURE: live-action, photorealistic, lifelike, 35mm film grain, 16:9 held across every shot.',
    filler,
  ].join('\n');
}

function packet(overrides: Partial<FilmmakingSeedancePacket> = {}): FilmmakingSeedancePacket {
  return {
    sceneIndex: 0,
    variant: 'text-driven',
    durationSeconds: 9,
    references: [],
    promptText: cleanBody(),
    warnings: [],
    ...overrides,
  };
}

function artifact(packets: FilmmakingSeedancePacket[]): FilmmakingPromptsArtifact {
  return {
    schemaVersion: 1,
    projectSlug: 'alpha',
    generatedAt: '2026-05-30T00:00:00.000Z',
    sourceSkill: 'ai-filmmaking',
    durationDefaultSeconds: 9,
    referenceMap: [],
    characterSheetPrompts: [],
    storyboardGridPrompt: null,
    seedancePackets: packets,
    issues: [],
  };
}

test('a clean text-driven packet lints ok with no issues', () => {
  const result = lintFilmmakingPrompts(artifact([packet()]));
  assert.equal(result.ok, true);
  assert.equal(result.packets.length, 1);
  assert.equal(result.packets[0]!.sceneIndex, 0);
  assert.deepEqual(result.packets[0]!.issues, []);
});

test('out-of-order blocks raise a (warning-level) block-order issue', () => {
  const broken = packet({ promptText: cleanBody().replace('SCENE & MOOD', 'ZZZ & MOOD') });
  const result = lintFilmmakingPrompts(artifact([broken]));
  // block-order is a warning, so ok stays true unless an error-severity issue
  // also fires; here we only assert the warning is reported.
  assert.ok(hasCode(result.packets[0]!.issues, 'seedance-block-order'));
});

test('missing SUBJECT LOCK / CAPTURE REALISM / CAMERA CAPTURE are flagged', () => {
  const body = cleanBody()
    .replace('SUBJECT LOCK: preserve the primary subject identical across every frame.', '')
    .replace('CAPTURE REALISM: anti-plastic capture treatment with believable skin texture.', '')
    .replace(/CAMERA CAPTURE:[^\n]*/, '');
  const result = lintFilmmakingPrompts(artifact([packet({ promptText: body })]));
  assert.ok(hasCode(result.packets[0]!.issues, 'missing-required-block'));
  assert.equal(result.ok, false);
});

test('grid-guard is required when a storyboard-grid reference is attached', () => {
  const withGrid = packet({
    variant: 'storyboard-grid-reference',
    references: [{ slot: '@image1', role: 'storyboard-grid', label: 'grid', status: 'ready' }],
    promptText: 'Use the grid as reference. SUBJECT LOCK: x. CAPTURE REALISM: y. CAMERA CAPTURE: z. NO TEXT ON SCREEN, NO MUSIC.\nStoryline: a chase.',
  });
  const result = lintFilmmakingPrompts(artifact([withGrid]));
  assert.ok(hasCode(result.packets[0]!.issues, 'grid-guard-missing'));
  assert.equal(result.ok, false);
});

test('Kelvin / hue-degree tokens are flagged in a prose-register packet', () => {
  const numericLeak = packet({
    promptText: cleanBody().replace(
      'CAMERA CAPTURE: live-action, photorealistic, lifelike, 35mm film grain, 16:9 held across every shot.',
      'CAMERA CAPTURE: 5200K key at 40°, shadows 190° 45% tint, 16:9 held across every shot.',
    ),
  });
  const result = lintFilmmakingPrompts(artifact([numericLeak]));
  assert.ok(hasCode(result.packets[0]!.issues, 'numeric-in-prose'));
  assert.equal(result.ok, false);
});

test('numeric register suppresses the Kelvin/hue check', () => {
  const numericLeak = packet({
    promptText: cleanBody().replace(
      'CAMERA CAPTURE: live-action, photorealistic, lifelike, 35mm film grain, 16:9 held across every shot.',
      'CAMERA CAPTURE: 5200K key at 40°, 16:9 held across every shot.',
    ),
  });
  const result = lintFilmmakingPrompts(artifact([numericLeak]), { register: 'numeric' });
  assert.ok(!hasCode(result.packets[0]!.issues, 'numeric-in-prose'));
});

test('word count outside 280-600 raises a warning', () => {
  const short = packet({ promptText: 'SCENE & MOOD: x\nSUBJECT LOCK: y\nCAPTURE REALISM: z\nCAMERA CAPTURE: w' });
  const result = lintFilmmakingPrompts(artifact([short]));
  assert.ok(hasCode(result.packets[0]!.issues, 'word-count'));
});

test('a proper-name leak is flagged when cast descriptors are provided', () => {
  const leak = packet({ promptText: cleanBody().replace('A lone figure', 'Rani') });
  const result = lintFilmmakingPrompts(artifact([leak]), {
    cast: [{ name: 'Rani', descriptor: 'a compact woman in a navy vest' }],
  });
  assert.ok(hasCode(result.packets[0]!.issues, 'proper-name-leak'));
  assert.equal(result.ok, false);
});

test('a brand leak is flagged when brand tokens are provided', () => {
  const leak = packet({ promptText: cleanBody().replace('A lone figure', 'A Nike runner') });
  const result = lintFilmmakingPrompts(artifact([leak]), { brands: ['Nike'] });
  assert.ok(hasCode(result.packets[0]!.issues, 'brand-leak'));
  assert.equal(result.ok, false);
});

test('lint is pure/deterministic across calls', () => {
  const a = lintFilmmakingPrompts(artifact([packet()]));
  const b = lintFilmmakingPrompts(artifact([packet()]));
  assert.deepEqual(a, b);
});
