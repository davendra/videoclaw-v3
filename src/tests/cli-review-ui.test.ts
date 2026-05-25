import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addCharacterProfile } from '../video/characters.js';
import { writeSceneCandidatesArtifact } from '../video/scene-candidate-store.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';

describe('vclaw review-ui cli', () => {
  it('prints launch metadata in dry-run mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'review-ui', '--project', 'alpha', '--root', root, '--port', '4321', '--dry-run'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        url?: string;
        dryRun?: boolean;
        projectSlug?: string;
        root?: string;
        uiPath?: string;
      };
      assert.equal(payload.projectSlug, 'alpha');
      assert.equal(payload.dryRun, true);
      assert.equal(payload.url, 'http://127.0.0.1:4321/review-ui?project=alpha');
      assert.equal(payload.root, root);
      assert.match(String(payload.uiPath), /tmp\/review-station\/index\.html$/);
      assert.ok(!String(payload.uiPath).startsWith(root));
      await access(String(payload.uiPath));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs review-autopilot from the CLI and completes the saved handoff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-autopilot-cli-'));
    try {
      const workspace = await ensureProjectWorkspace('auto-cli', root);
      await writeProjectManifest(workspace, {
        slug: 'auto-cli',
        productionMode: 'director',
        createdAt: '2026-05-06T08:00:00.000Z',
        updatedAt: '2026-05-06T08:00:00.000Z',
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'completed',
      });
      await addCharacterProfile(workspace, {
        name: 'Proofy',
        goBananasId: 249,
        description: 'A flat illustrated proof mascot.',
        referenceAssets: [],
        notes: [],
      });
      await mkdir(join(workspace.projectDir, 'assets', 'storyboard'), { recursive: true });
      for (let index = 0; index < 4; index += 1) {
        await writeFile(join(workspace.projectDir, 'assets', 'storyboard', `scene-${index}.jpg`), `fake-image-${index}`);
      }
      await writeSceneCandidatesArtifact(root, 'auto-cli', {
        schemaVersion: 1,
        scenes: Array.from({ length: 4 }, (_, sceneIndex) => ({
          sceneIndex,
          candidates: [
            {
              id: `scene-${sceneIndex}-take-1`,
              generationRound: 1,
              prompt: `Proofy locked storyboard still for scene ${sceneIndex}.`,
              route: 'gobananas-storyboard-still',
              submittedAt: '2026-05-06T09:00:00.000Z',
              status: 'completed',
              outputs: [{ kind: 'image', path: `assets/storyboard/scene-${sceneIndex}.jpg` }],
              source: {
                executionRound: 0,
                adapter: 'custom',
                externalJobId: `proofy-${sceneIndex}`,
                chainedFromCandidateId: null,
              },
            },
          ],
        })),
      });

      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [cliPath, 'video', 'review-autopilot', '--project', 'auto-cli', '--root', root, '--run-id', 'cli-test-run'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        character?: string;
        lockedStills?: unknown[];
        decision?: { lifecycle?: { status?: string } };
        reviewReport?: { verdict?: string };
      };
      assert.equal(payload.character, 'proofy');
      assert.equal(payload.lockedStills?.length, 4);
      assert.equal(payload.decision?.lifecycle?.status, 'completed');
      assert.equal(payload.reviewReport?.verdict, 'pass');

      const reviewReport = JSON.parse(
        await readFile(join(workspace.artifactsDir, 'review-report.json'), 'utf-8'),
      ) as { metrics?: { publishReady?: boolean } };
      assert.equal(reviewReport.metrics?.publishReady, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
