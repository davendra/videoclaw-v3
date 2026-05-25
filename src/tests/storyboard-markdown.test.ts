import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import { buildVideoCostEstimate } from '../video/cost-estimate.js';
import type { DirectorPreflightResult } from '../video/director-preflight.js';
import {
  buildStoryboardMarkdown,
  isStoryboardApproved,
  storyboardMarkdownPathFor,
  writeStoryboardMarkdownReview,
} from '../video/storyboard-markdown.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';

describe('storyboard-markdown', () => {
  const preflight: DirectorPreflightResult = {
    pass: false,
    errors: [{
      severity: 'error',
      code: 'CONTENT_FILTER_HAZARD',
      scope: 'scene:0',
      message: 'Scene 1 contains provider-risk wording: "spectral blade".',
      suggestion: 'Rewrite with safer phrasing.',
    }],
    warnings: [{
      severity: 'warn',
      code: 'PRONOUN_DRIFT',
      scope: 'scene:0',
      message: 'Scene 1 contains pronoun drift for Nova.',
    }],
  };

  it('builds a human-readable storyboard review markdown file', () => {
    const markdown = buildStoryboardMarkdown({
      projectSlug: 'alpha',
      root: '/tmp/alpha-root',
      brief: createBriefArtifact({
        title: 'Alpha',
        intent: 'Alpha intent',
        productionMode: 'director',
        metadata: { targetRuntimeSeconds: 90, genre: 'sci-fi', platform: 'youtube', style: 'villeneuve', colorGrading: 'neon-noir' },
      }),
      storyboard: createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'director',
        scenes: [{
          sceneIndex: 0,
          description: 'Scene one',
          scenePrompt: {
            imagePrompt: 'Static frame of Nova beside the console.',
            animationPrompt: 'Slow push-in as monitor light flickers across her face.',
            cameraMove: 'push-in',
            styleFooter: 'cold blue and amber practical lighting',
          },
          characters: ['Nova'],
          durationSeconds: 15,
        }],
      }),
      characterProfiles: [{
        id: 'nova',
        name: 'Nova',
        goBananasId: 170,
        description: 'A determined woman in a silver jacket.',
        referenceAssets: ['refs/nova.png'],
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z',
      }],
      executionPlan: {
        executionProfile: {
          aspectRatio: '16:9',
          quality: 'quality',
          resolution: '1080p',
          generateAudio: true,
          outputCount: 2,
        },
        promptGuidance: [{ name: 'stage-directors', reason: 'Keep stage discipline.', category: 'framework' }],
        recommendedRouteId: 'veo-useapi',
      },
      costEstimate: buildVideoCostEstimate({
        sceneCount: 14,
        clipDurationSeconds: 15,
        newCharacterCount: 2,
        narrationEnabled: true,
      }),
      preflight,
      generatedAt: '2026-04-21T00:00:00.000Z',
    });

    assert.match(markdown, /# Storyboard Review - Alpha/);
    assert.match(markdown, /Scene 1/);
    assert.match(markdown, /Prompt split:/);
    assert.match(markdown, /Image prompt: Static frame of Nova beside the console\./);
    assert.match(markdown, /Animation prompt: Slow push-in as monitor light flickers across her face\./);
    assert.match(markdown, /Camera move: push-in/);
    assert.match(markdown, /Style footer: cold blue and amber practical lighting/);
    assert.match(markdown, /Nova/);
    assert.match(markdown, /\| Genre \| sci-fi \|/);
    assert.match(markdown, /\| Style \| villeneuve \|/);
    assert.match(markdown, /\| Color grading \| neon-noir \|/);
    assert.match(markdown, /\| Target runtime \| 90s \|/);
    assert.match(markdown, /## Cost Estimate/);
    assert.match(markdown, /\| Total \| \$5\.87 \|/);
    assert.match(markdown, /\| Estimated wall time \| ~61 min \|/);
    assert.match(markdown, /## Character Bindings/);
    assert.match(markdown, /\| Nova \| 170 \| refs\/nova\.png \|/);
    assert.match(markdown, /## Preflight/);
    assert.match(markdown, /CONTENT_FILTER_HAZARD/);
    assert.match(markdown, /vclaw video verify-env --root "\/tmp\/alpha-root"/);
    assert.match(markdown, /VIDEOCLAW_APPROVE_STORYBOARD=1 vclaw video execute --project "alpha" --root "\/tmp\/alpha-root" --mode director/);
    assert.match(markdown, /vclaw video storyboard-review --project "alpha" --root "\/tmp\/alpha-root" --mode director/);
  });

  it('writes storyboard.md into the project directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-storyboard-markdown-'));
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
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Alpha',
        intent: 'Alpha intent',
        productionMode: 'director',
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'director',
        scenes: [{ sceneIndex: 0, description: 'Scene one', characters: ['Nova', 'Mochi'] }],
      }));
      await addCharacterProfile(workspace, {
        name: 'Nova',
        goBananasId: 170,
        referenceAssets: ['refs/nova.png'],
      });
      await addCharacterProfile(workspace, {
        name: 'Mochi',
        goBananasId: 247,
      });

      const result = await writeStoryboardMarkdownReview({
        projectSlug: 'alpha',
        root,
        executionPlan: {
          executionProfile: {
            aspectRatio: '16:9',
            quality: 'quality',
            resolution: '1080p',
            generateAudio: false,
            outputCount: 1,
          },
        promptGuidance: [],
        recommendedRouteId: 'seedance-direct',
      },
      costEstimate: buildVideoCostEstimate({
        sceneCount: 3,
        clipDurationSeconds: 15,
        newCharacterCount: 1,
        narrationEnabled: false,
      }),
      preflight,
      });

      const file = await readFile(result.markdownPath, 'utf-8');
      assert.equal(result.markdownPath, storyboardMarkdownPathFor('alpha', root));
      assert.match(file, /Alpha intent/);
      assert.match(file, /seedance-direct/);
      assert.match(file, /\| Total \| \$1\.28 \|/);
      assert.match(file, /vclaw video verify-env --root /);
      assert.match(file, /VIDEOCLAW_APPROVE_STORYBOARD=1 vclaw video execute --project "alpha" --root /);
      assert.match(file, /vclaw video storyboard-review --project "alpha" --root /);
      assert.match(file, /\| Nova \| 170 \| refs\/nova\.png \|/);
      assert.match(file, /\| Mochi \| 247 \| \(none\) \|/);
      assert.match(file, /PRONOUN_DRIFT/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('detects storyboard approval from env', () => {
    assert.equal(isStoryboardApproved({ VIDEOCLAW_APPROVE_STORYBOARD: '1' } as NodeJS.ProcessEnv), true);
    assert.equal(isStoryboardApproved({ VIDEOCLAW_APPROVE_STORYBOARD: 'true' } as NodeJS.ProcessEnv), true);
    assert.equal(isStoryboardApproved({} as NodeJS.ProcessEnv), false);
  });
});
