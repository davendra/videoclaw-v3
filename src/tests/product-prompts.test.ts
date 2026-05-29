import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { generateFilmmakingPrompts } from '../video/filmmaking-prompts.js';
import { readProductReferences } from '../video/product-references.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

async function writeProductReferences(
  artifactsDir: string,
  products: { name: string; referenceAssets: string[] }[],
): Promise<void> {
  await writeFile(
    join(artifactsDir, 'product-references.json'),
    `${JSON.stringify({ schemaVersion: 1, products }, null, 2)}\n`,
  );
}

describe('product-references reader', () => {
  it('returns an empty product list when the file is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-product-refs-'));
    const workspace = await ensureProjectWorkspace('absent', root);
    const result = await readProductReferences(workspace);
    assert.deepEqual(result, { schemaVersion: 1, products: [] });
  });

  it('reads products with reference assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-product-refs-'));
    const workspace = await ensureProjectWorkspace('present', root);
    await writeProductReferences(workspace.artifactsDir, [
      { name: 'Aurora Bottle', referenceAssets: ['assets/aurora-hero.jpg', 'assets/aurora-side.jpg'] },
    ]);
    const result = await readProductReferences(workspace);
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0]!.name, 'Aurora Bottle');
    assert.deepEqual(result.products[0]!.referenceAssets, ['assets/aurora-hero.jpg', 'assets/aurora-side.jpg']);
  });
});

describe('filmmaking product-subject branch', () => {
  it('builds product packets (ad hook/feature/CTA) without character sheets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-product-ad-'));
    const workspace = await ensureProjectWorkspace('ad', root);
    await writeArtifact(workspace, 'brief', createBriefArtifact({
      title: 'Aurora Launch',
      intent: 'Sell the Aurora water bottle.',
      productionMode: 'storyboard',
    }));
    await writeProductReferences(workspace.artifactsDir, [
      { name: 'Aurora Bottle', referenceAssets: ['assets/aurora-hero.jpg'] },
    ]);

    const { artifact } = await generateFilmmakingPrompts({
      root,
      projectSlug: 'ad',
      category: 'ecommerce-ad',
      durationSeconds: 12,
    });

    // No character-sheet prompts on the product path.
    assert.equal(artifact.characterSheetPrompts.length, 0);
    // No storyboard-grid character lock.
    assert.equal(artifact.storyboardGridPrompt, null);
    // Packets exist and reflect the ad-hook-feature-cta beat structure.
    assert.ok(artifact.seedancePackets.length > 0);
    const allText = artifact.seedancePackets.map((p) => p.promptText).join('\n');
    assert.match(allText, /hook/i);
    assert.match(allText, /CTA|feature/i);
    // Product name and reference asset appear.
    assert.match(allText, /Aurora Bottle/);
    const allRefs = artifact.seedancePackets.flatMap((p) => p.references.map((r) => r.path ?? ''));
    assert.ok(allRefs.includes('assets/aurora-hero.jpg'));
  });

  it('builds product-360 turntable packets with orbit grammar and hero angle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-product-360-'));
    const workspace = await ensureProjectWorkspace('turn', root);
    await writeArtifact(workspace, 'brief', createBriefArtifact({
      title: 'Aurora Turntable',
      intent: 'Show every angle of the Aurora bottle.',
      productionMode: 'storyboard',
    }));
    await writeProductReferences(workspace.artifactsDir, [
      { name: 'Aurora Bottle', referenceAssets: ['assets/aurora-hero.jpg'] },
    ]);

    const { artifact } = await generateFilmmakingPrompts({
      root,
      projectSlug: 'turn',
      category: 'product-360',
      durationSeconds: 12,
    });

    assert.equal(artifact.characterSheetPrompts.length, 0);
    const allText = artifact.seedancePackets.map((p) => p.promptText).join('\n');
    assert.match(allText, /orbit|turntable|rotat/i);
    assert.match(allText, /hero angle/i);
    assert.match(allText, /Aurora Bottle/);
  });

  it('leaves the character/cinematic path unchanged (still emits character sheets)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-product-char-'));
    const workspace = await ensureProjectWorkspace('char', root);
    await addCharacterProfile(workspace, {
      name: 'Meera',
      description: 'late twenties Indian woman, athletic build, sharp brown eyes, charcoal tactical jacket',
      referenceAssets: ['characters/meera-sheet.jpg'],
    });
    await writeArtifact(workspace, 'brief', createBriefArtifact({
      title: 'Cinematic Probe',
      intent: 'A narrative scene.',
      productionMode: 'director',
    }));

    // Default category (cinematic) — character path.
    const { artifact } = await generateFilmmakingPrompts({
      root,
      projectSlug: 'char',
      durationSeconds: 15,
    });

    assert.equal(artifact.characterSheetPrompts.length, 1);
    assert.equal(artifact.characterSheetPrompts[0]!.characterName, 'Meera');
  });
});
