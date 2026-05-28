import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { buildProjectReadiness } from '../video/readiness.js';
import { writeReferenceSheetsArtifact } from '../video/reference-sheet-store.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';

function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe('buildProjectReadiness', () => {
  it('reports missing artifacts until the required set is present', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-readiness-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(workspace, {
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'brief',
        lastCompletedStage: null,
        lastCheckpointStatus: 'pending',
      });

      let readiness = await buildProjectReadiness('alpha', root);
      assert.equal(readiness.ready, false);
      assert.ok(readiness.missingArtifacts.includes('brief'));

      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Alpha intent',
        productionMode: 'storyboard',
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        scenes: [{ sceneIndex: 0, description: 'Scene one' }],
      }));
      await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'alpha',
        assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png' }],
      });

      readiness = await buildProjectReadiness('alpha', root);
      assert.equal(readiness.ready, true);
      assert.deepEqual(readiness.missingArtifacts, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks readiness when storyboard characters do not have valid profiles and anchors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-readiness-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(workspace, {
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'completed',
      });

      await addCharacterProfile(workspace, {
        name: 'Nova',
      });
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Alpha intent',
        productionMode: 'storyboard',
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        scenes: [
          { sceneIndex: 0, description: 'Scene one', characters: ['Nova', 'Ghost'] },
        ],
      }));
      await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'alpha',
        assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png' }],
      });

      const readiness = await buildProjectReadiness('alpha', root);
      assert.equal(readiness.ready, false);
      assert.deepEqual(readiness.characterConsistency.referencedCharacters, ['Ghost', 'Nova']);
      assert.ok(readiness.blockers.some((item) => item.includes('Missing character profiles: Ghost')));
      assert.ok(readiness.blockers.some((item) => item.includes('Characters missing reference assets: Nova')));
      assert.equal(readiness.nextAction, 'Resolve character consistency issues before execution.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('warns when source image dimensions do not match execution-profile expectations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-readiness-images-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(workspace, {
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'completed',
      });
      const sourcePath = join(workspace.projectDir, 'portrait.png');
      await writeFile(sourcePath, pngHeader(720, 1280));
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Alpha intent',
        productionMode: 'storyboard',
        metadata: {
          executionProfile: {
            aspectRatio: '16:9',
            resolution: '1080p',
          },
        },
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        scenes: [{ sceneIndex: 0, description: 'Scene one' }],
      }));
      await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'alpha',
        assets: [
          { id: 'image-a', kind: 'image', path: 'portrait.png', sceneIndex: 0 },
          { id: 'image-missing', kind: 'image', path: 'missing-local.png', sceneIndex: 1 },
        ],
      });

      const readiness = await buildProjectReadiness('alpha', root);
      assert.equal(readiness.ready, true);
      assert.ok(readiness.warnings.some((warning) => warning.includes('image-input-aspect-ratio-mismatch')));
      assert.ok(readiness.warnings.some((warning) => warning.includes('image-input-low-resolution')));
      assert.ok(readiness.warnings.some((warning) => warning.includes('image-input-missing')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('warns but does not block when an optional multi-shot prompt artifact is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-readiness-multishot-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(workspace, {
        slug: 'alpha',
        productionMode: 'storyboard',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('storyboard'),
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'completed',
      });
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Alpha intent',
        productionMode: 'storyboard',
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'storyboard',
        scenes: [{ sceneIndex: 0, description: 'Scene one' }],
      }));
      await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'alpha',
        assets: [],
      });
      await writeArtifact(workspace, 'multi-shot-prompt', {
        preset: 'cinematic-15s',
        location: 'Alpha',
        timeOfDay: 'night',
        shots: [],
        promptText: 'bad prompt',
        charCount: 10,
        valid: false,
        issues: [{ code: 'multi-shot-timecode-parse', severity: 'error', message: 'No parseable timecodes.' }],
        generatedAt: now,
      });

      const readiness = await buildProjectReadiness('alpha', root);
      assert.equal(readiness.ready, true);
      assert.equal(readiness.multiShotPrompt?.valid, false);
      assert.equal(readiness.multiShotPrompt?.issueCount, 1);
      assert.ok(readiness.warnings.some((warning) => warning.includes('multi-shot-prompt-invalid')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('warns when director identity sheets have thin coverage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-readiness-refsheet-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const now = new Date().toISOString();
      await writeProjectManifest(workspace, {
        slug: 'alpha',
        productionMode: 'director',
        createdAt: now,
        updatedAt: now,
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'completed',
      });
      await addCharacterProfile(workspace, {
        name: 'Nova',
        referenceAssets: ['refs/nova.png'],
      });
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Alpha intent',
        productionMode: 'director',
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'director',
        scenes: [{ sceneIndex: 0, description: 'Nova presents the product.', characters: ['Nova'] }],
      }));
      await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'alpha',
        assets: [],
      });
      await writeReferenceSheetsArtifact(root, 'alpha', {
        schemaVersion: 1,
        sheets: [{
          id: 'sheet-001',
          type: 'identity',
          name: 'Nova identity',
          characterName: 'Nova',
          references: [{ path: 'refs/nova.png', role: 'identity' }],
          bindings: { sceneIndices: [0] },
          createdAt: now,
          updatedAt: now,
        }],
      });

      const readiness = await buildProjectReadiness('alpha', root, 'director');
      assert.equal(readiness.ready, true);
      assert.ok(readiness.warnings.some((warning) => warning.includes('reference-sheet-thin-identity-coverage')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
