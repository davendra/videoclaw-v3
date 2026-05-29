import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { generateFilmmakingPrompts } from '../video/filmmaking-prompts.js';
import { renderStoryboardGrid } from '../video/storyboard-grid.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('storyboard grid renderer', () => {
  it('renders a 3x3 PNG and marks the filmmaking prompt grid slot ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-storyboard-grid-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha Grid',
        intent: 'A cinematic courier chase.',
        productionMode: 'director',
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'director',
        scenes: [{
          sceneIndex: 0,
          description: 'Courier cuts through a tunnel of red warning lights',
          scenePrompt: {
            animationPrompt: 'Courier runs forward while red warning lights sweep across the tunnel walls.',
          },
        }],
      }));
      await generateFilmmakingPrompts({
        root,
        projectSlug: 'alpha',
        panelCount: 9,
        write: true,
      });

      const result = await renderStoryboardGrid({
        root,
        projectSlug: 'alpha',
        width: 960,
        height: 540,
      });

      assert.equal(result.artifactReferencePath, 'assets/storyboard-grid.png');
      assert.equal(result.panelCount, 9);
      assert.equal(result.width, 960);
      assert.equal(result.height, 540);

      const bytes = await readFile(result.outputPath);
      assert.ok(bytes.subarray(0, 4).equals(PNG_MAGIC));
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, 'png');
      assert.equal(metadata.width, 960);
      assert.equal(metadata.height, 540);

      const updated = JSON.parse(await readFile(result.artifactPath, 'utf-8')) as {
        referenceMap?: Array<{ role?: string; path?: string; status?: string }>;
        seedancePackets?: Array<{
          references?: Array<{ role?: string; path?: string; status?: string }>;
          warnings?: string[];
        }>;
        issues?: Array<{ code?: string }>;
      };
      assert.equal(updated.referenceMap?.some((slot) => (
        slot.role === 'storyboard-grid'
        && slot.path === 'assets/storyboard-grid.png'
        && slot.status === 'ready'
      )), true);
      assert.equal(updated.seedancePackets?.[0]?.references?.some((reference) => (
        reference.role === 'storyboard-grid'
        && reference.path === 'assets/storyboard-grid.png'
        && reference.status === 'ready'
      )), true);
      assert.equal(updated.seedancePackets?.[0]?.warnings?.length, 0);
      assert.equal(updated.issues?.some((issue) => issue.code === 'storyboard-grid-pending'), false);
      assert.equal(updated.issues?.some((issue) => issue.code === 'reference-slot-pending'), false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
