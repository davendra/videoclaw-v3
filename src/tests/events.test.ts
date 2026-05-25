import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { appendProjectEvent, readProjectEvents } from '../video/events.js';
import { executeProject } from '../video/execute.js';
import { buildTimeline } from '../video/timeline.js';
import { ensureProjectWorkspace, writeProjectManifest } from '../video/workspace.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';

describe('project events', () => {
  it('appends and reads project events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-events-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      await appendProjectEvent(workspace, { type: 'project.initialized', payload: { productionMode: 'storyboard' } });
      await appendProjectEvent(workspace, { type: 'artifact.brief.written', payload: { title: 'Alpha' } });
      const events = await readProjectEvents(workspace);
      assert.equal(events.length, 2);
      assert.equal(events[0]?.type, 'project.initialized');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('builds a cross-project timeline ordered by latest event first', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-timeline-'));
    try {
      const alpha = await ensureProjectWorkspace('alpha', root);
      const beta = await ensureProjectWorkspace('beta', root);
      await appendProjectEvent(alpha, { type: 'artifact.brief.written', recordedAt: '2026-04-20T10:00:00.000Z' });
      await appendProjectEvent(beta, { type: 'artifact.storyboard.written', recordedAt: '2026-04-20T11:00:00.000Z' });
      const timeline = await buildTimeline(root);
      assert.equal(timeline.length, 2);
      assert.equal(timeline[0]?.slug, 'beta');
      assert.equal(timeline[1]?.slug, 'alpha');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records storyboard review generation as a project event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-events-review-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'init', 'alpha', '--root', root, '--mode', 'director'],
        ['video', 'brief', '--project', 'alpha', '--root', root, '--mode', 'director', '--title', 'Alpha', '--intent', 'Alpha intent'],
        ['video', 'storyboard', '--project', 'alpha', '--root', root, '--mode', 'director', '--scene', 'Scene one'],
        ['video', 'storyboard-review', '--project', 'alpha', '--root', root, '--mode', 'director'],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const workspace = await ensureProjectWorkspace('alpha', root);
      const events = await readProjectEvents(workspace);
      const reviewEvent = events.find((event) => event.type === 'storyboard.review.generated');
      assert.ok(reviewEvent);
      assert.match(String(reviewEvent?.payload?.markdownPath), /storyboard\.md$/);

      const timeline = await buildTimeline(root);
      assert.equal(timeline[0]?.type, 'storyboard.review.generated');
      assert.equal(timeline[0]?.slug, 'alpha');
      assert.match(String(timeline[0]?.payload?.markdownPath), /storyboard\.md$/);

      const markdown = await readFile(join(root, 'projects', 'alpha', 'storyboard.md'), 'utf-8');
      assert.match(markdown, /# Storyboard Review - Alpha/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records create-time character hydration as a project event', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-events-hydration-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'create',
          'Komo and Mochi sprint through a neon alley.',
          '--project',
          'alpha',
          '--root',
          root,
          '--production-mode',
          'director',
          '--scenes',
          '3',
          '--gb-character',
          'Komo:170',
          '--gb-character',
          'Mochi:247',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);

      const workspace = await ensureProjectWorkspace('alpha', root);
      const events = await readProjectEvents(workspace);
      const hydrationEvent = events.find((event) => event.type === 'character.hydrated');
      assert.ok(hydrationEvent);
      assert.deepEqual(hydrationEvent?.payload?.explicit, [
        { name: 'Komo', goBananasId: 170 },
        { name: 'Mochi', goBananasId: 247 },
      ]);
      assert.deepEqual(hydrationEvent?.payload?.final, [
        { name: 'Komo', goBananasId: 170 },
        { name: 'Mochi', goBananasId: 247 },
      ]);

      const timeline = await buildTimeline(root);
      assert.ok(timeline.some((event) => event.type === 'character.hydrated' && event.slug === 'alpha'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records stale review execution blocks as project events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-events-review-block-'));
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
        scenes: [{ sceneIndex: 0, description: 'Scene one', durationSeconds: 15 }],
      }));
      await writeArtifact(workspace, 'asset-manifest', {
        projectSlug: 'alpha',
        assets: [{ id: 'image-a', kind: 'image', path: '/tmp/image.png', sceneIndex: 0, backend: 'veo-useapi' }],
      });
      await writeFile(join(root, '.env.local'), 'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n');
      await writeFile(join(root, 'projects', 'alpha', 'storyboard.md'), '# Review\n');
      await appendProjectEvent(workspace, {
        type: 'storyboard.review.generated',
        recordedAt: '2026-04-20T10:00:00.000Z',
        payload: { markdownPath: join(root, 'projects', 'alpha', 'storyboard.md') },
      });
      const later = '2026-04-20T10:00:01.000Z';
      await appendProjectEvent(workspace, {
        type: 'artifact.storyboard.written',
        recordedAt: later,
        payload: { artifactPath: join(root, 'projects', 'alpha', 'artifacts', 'storyboard.json') },
      });

      const executeResult = await executeProject('alpha', {
        root,
        productionMode: 'director',
        dryRun: true,
        env: {
          ...process.env,
          VIDEOCLAW_APPROVE_STORYBOARD: '1',
        },
      });
      assert.equal(executeResult.report.status, 'blocked');
      assert.ok(executeResult.report.blockers.some((item) => item.includes('Storyboard review is stale')));

      const events = await readProjectEvents(workspace);
      const staleEvent = events.find((event) => event.type === 'storyboard.review.stale.blocked');
      assert.ok(staleEvent);
      assert.match(String(staleEvent?.payload?.markdownPath), /storyboard\.md$/);

      const timeline = await buildTimeline(root);
      assert.equal(timeline[0]?.type, 'storyboard.review.stale.blocked');
      assert.equal(timeline[0]?.slug, 'alpha');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
