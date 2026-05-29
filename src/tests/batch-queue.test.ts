import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildBatchPayload,
  readBatchManifest,
  readNativeJobSceneStates,
  writeBatchQueueState,
  readBatchQueueState,
  rollupBatchQueueState,
  clipPathForJob,
  sceneOutputPathFor,
  type BatchQueueManifest,
  type BatchQueueState,
} from '../video/batch-queue.js';

async function tmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vclaw-batch-'));
}

const VALID_MANIFEST: BatchQueueManifest = {
  schemaVersion: 1,
  route: 'runway-useapi',
  defaults: { seconds: 8, aspectRatio: '16:9', resolution: '720p' },
  jobs: [
    { id: 'alpha', prompt: 'a neon city at night' },
    { id: 'bravo', prompt: 'a quiet forest', keyframe: '/tmp/forest.jpg', seconds: 10 },
    { id: 'charlie', prompt: 'a desert dawn', aspectRatio: '9:16' },
  ],
};

test('readBatchManifest parses a valid manifest', async () => {
  const root = await tmpRoot();
  const path = join(root, 'manifest.json');
  await writeFile(path, JSON.stringify(VALID_MANIFEST));
  const manifest = await readBatchManifest(path);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.route, 'runway-useapi');
  assert.equal(manifest.jobs.length, 3);
  assert.equal(manifest.jobs[1].keyframe, '/tmp/forest.jpg');
  assert.equal(manifest.defaults?.seconds, 8);
});

test('readBatchManifest defaults route to runway-useapi when omitted', async () => {
  const root = await tmpRoot();
  const path = join(root, 'manifest.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 1, jobs: [{ id: 'x', prompt: 'p' }] }));
  const manifest = await readBatchManifest(path);
  assert.equal(manifest.route, 'runway-useapi');
});

test('readBatchManifest throws on malformed JSON', async () => {
  const root = await tmpRoot();
  const path = join(root, 'bad.json');
  await writeFile(path, '{ not json ');
  await assert.rejects(() => readBatchManifest(path), /batch manifest/i);
});

test('readBatchManifest throws when jobs missing', async () => {
  const root = await tmpRoot();
  const path = join(root, 'no-jobs.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 1 }));
  await assert.rejects(() => readBatchManifest(path), /at least one job/i);
});

test('readBatchManifest throws when a job is missing id or prompt', async () => {
  const root = await tmpRoot();
  const path = join(root, 'bad-job.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 1, jobs: [{ prompt: 'no id' }] }));
  await assert.rejects(() => readBatchManifest(path), /job .* requires/i);
});

test('readBatchManifest throws on duplicate job ids', async () => {
  const root = await tmpRoot();
  const path = join(root, 'dupe.json');
  await writeFile(
    path,
    JSON.stringify({ schemaVersion: 1, jobs: [{ id: 'a', prompt: 'p1' }, { id: 'a', prompt: 'p2' }] }),
  );
  await assert.rejects(() => readBatchManifest(path), /duplicate job id/i);
});

test('readBatchManifest throws on unsupported schemaVersion', async () => {
  const root = await tmpRoot();
  const path = join(root, 'ver.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 2, jobs: [{ id: 'a', prompt: 'p' }] }));
  await assert.rejects(() => readBatchManifest(path), /schemaVersion/i);
});

test('readBatchManifest throws on unsupported route', async () => {
  const root = await tmpRoot();
  const path = join(root, 'route.json');
  await writeFile(
    path,
    JSON.stringify({ schemaVersion: 1, route: 'veo-direct', jobs: [{ id: 'a', prompt: 'p' }] }),
  );
  await assert.rejects(() => readBatchManifest(path), /route/i);
});

test('buildBatchPayload maps N jobs to N tasks with correct fields', () => {
  const payload = buildBatchPayload(VALID_MANIFEST, {
    workspaceRoot: '/ws',
    outputDir: '/out',
  });
  assert.equal(payload.routeId, 'runway-useapi');
  assert.equal(payload.workspaceRoot, '/ws');
  assert.equal(payload.outputDir, '/out');
  assert.equal(payload.tasks.length, 3);

  // job 0: defaults applied (seconds 8), no keyframe
  assert.equal(payload.tasks[0].sceneIndex, 0);
  assert.equal(payload.tasks[0].prompt, 'a neon city at night');
  assert.equal(payload.tasks[0].durationSeconds, 8);
  assert.deepEqual(payload.tasks[0].referencePaths, []);
  assert.equal(payload.tasks[0].inputKind, 'text');

  // job 1: keyframe -> referencePaths, seconds override 10
  assert.equal(payload.tasks[1].sceneIndex, 1);
  assert.deepEqual(payload.tasks[1].referencePaths, ['/tmp/forest.jpg']);
  assert.equal(payload.tasks[1].durationSeconds, 10);
  assert.equal(payload.tasks[1].inputKind, 'image');

  // job 2: aspectRatio override carried at task level not applicable; default seconds
  assert.equal(payload.tasks[2].sceneIndex, 2);
  assert.equal(payload.tasks[2].durationSeconds, 8);
});

test('buildBatchPayload applies default aspectRatio to executionProfile', () => {
  const payload = buildBatchPayload(VALID_MANIFEST, { workspaceRoot: '/ws', outputDir: '/out' });
  assert.equal(payload.executionProfile.aspectRatio, '16:9');
  assert.equal(payload.executionProfile.resolution, '720p');
});

test('buildBatchPayload falls back to safe defaults when manifest omits them', () => {
  const manifest: BatchQueueManifest = {
    schemaVersion: 1,
    route: 'dreamina-useapi',
    jobs: [{ id: 'only', prompt: 'p' }],
  };
  const payload = buildBatchPayload(manifest, { workspaceRoot: '/ws', outputDir: '/out' });
  assert.equal(payload.routeId, 'dreamina-useapi');
  assert.equal(payload.executionProfile.aspectRatio, '16:9');
  assert.equal(payload.executionProfile.resolution, '720p');
  assert.equal(payload.tasks[0].durationSeconds, 8);
});

test('queue-state write/read round-trips', async () => {
  const root = await tmpRoot();
  const outDir = join(root, 'out');
  await mkdir(outDir, { recursive: true });
  const state: BatchQueueState = {
    schemaVersion: 1,
    externalJobId: 'runway-useapi-123',
    route: 'runway-useapi',
    outputDir: outDir,
    workspaceRoot: root,
    submittedAt: '2026-05-29T00:00:00.000Z',
    jobs: [
      { id: 'alpha', sceneIndex: 0, taskId: 't0', status: 'pending' },
      { id: 'bravo', sceneIndex: 1, taskId: 't1', status: 'done', clipPath: join(outDir, 'clips', 'bravo.mp4') },
    ],
  };
  await writeBatchQueueState(state);
  const loaded = await readBatchQueueState(outDir);
  assert.deepEqual(loaded, state);
});

test('readBatchQueueState throws when state file is missing', async () => {
  const root = await tmpRoot();
  await assert.rejects(() => readBatchQueueState(root), /batch-queue\.json/i);
});

test('rollupBatchQueueState counts done/pending/failed correctly', () => {
  const state: BatchQueueState = {
    schemaVersion: 1,
    externalJobId: 'x',
    route: 'runway-useapi',
    outputDir: '/out',
    workspaceRoot: '/ws',
    submittedAt: '2026-05-29T00:00:00.000Z',
    jobs: [
      { id: 'a', sceneIndex: 0, taskId: 't0', status: 'done' },
      { id: 'b', sceneIndex: 1, taskId: 't1', status: 'pending' },
      { id: 'c', sceneIndex: 2, taskId: 't2', status: 'failed' },
      { id: 'd', sceneIndex: 3, taskId: 't3', status: 'done' },
    ],
  };
  const rollup = rollupBatchQueueState(state);
  assert.equal(rollup.total, 4);
  assert.equal(rollup.done, 2);
  assert.equal(rollup.pending, 1);
  assert.equal(rollup.failed, 1);
  assert.equal(rollup.terminal, false);
});

test('rollupBatchQueueState reports terminal when nothing pending', () => {
  const state: BatchQueueState = {
    schemaVersion: 1,
    externalJobId: 'x',
    route: 'runway-useapi',
    outputDir: '/out',
    workspaceRoot: '/ws',
    submittedAt: '2026-05-29T00:00:00.000Z',
    jobs: [
      { id: 'a', sceneIndex: 0, taskId: 't0', status: 'done' },
      { id: 'c', sceneIndex: 1, taskId: 't1', status: 'failed' },
    ],
  };
  assert.equal(rollupBatchQueueState(state).terminal, true);
});

test('clipPathForJob and sceneOutputPathFor compute the scene->clip mapping', () => {
  assert.equal(sceneOutputPathFor('/out', 2), join('/out', 'scene-2.mp4'));
  assert.equal(clipPathForJob('/out', 'bravo'), join('/out', 'clips', 'bravo.mp4'));
});

test('readBatchManifest throws on unsupported defaults.resolution', async () => {
  const root = await tmpRoot();
  const path = join(root, 'bad-res.json');
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      defaults: { resolution: '4k' },
      jobs: [{ id: 'a', prompt: 'p' }],
    }),
  );
  await assert.rejects(() => readBatchManifest(path), /defaults\.resolution/i);
});

test('readBatchManifest throws on unsupported defaults.aspectRatio', async () => {
  const root = await tmpRoot();
  const path = join(root, 'bad-ar.json');
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      defaults: { aspectRatio: '4:3' },
      jobs: [{ id: 'a', prompt: 'p' }],
    }),
  );
  await assert.rejects(() => readBatchManifest(path), /defaults\.aspectRatio/i);
});

test('readNativeJobSceneStates: scene 0 failed, scene 1 submitted — one-failed-does-not-strand-pending', async () => {
  const root = await tmpRoot();
  const outDir = join(root, 'out');
  const jobStateDir = join(outDir, '.vclaw-jobs');
  await mkdir(jobStateDir, { recursive: true });

  const externalJobId = 'runway-useapi-test-999';
  const nativeJobState = {
    externalJobId,
    routeId: 'runway-useapi',
    outputDir: outDir,
    createdAt: '2026-05-29T00:00:00.000Z',
    scenes: [
      {
        sceneIndex: 0,
        prompt: 'p0',
        taskId: 't0',
        outputPath: join(outDir, 'scene-0.mp4'),
        status: 'failed',
        error: 'scene 0 exploded',
      },
      {
        sceneIndex: 1,
        prompt: 'p1',
        taskId: 't1',
        outputPath: join(outDir, 'scene-1.mp4'),
        status: 'submitted',
      },
    ],
  };
  await writeFile(join(jobStateDir, `${externalJobId}.json`), `${JSON.stringify(nativeJobState, null, 2)}\n`);

  const sceneStates = await readNativeJobSceneStates(outDir, externalJobId);

  // scene 0: failed with its own error
  const s0 = sceneStates.get(0);
  assert.ok(s0, 'scene 0 present');
  assert.equal(s0.status, 'failed');
  assert.equal(s0.error, 'scene 0 exploded');

  // scene 1: still submitted (pending) — not contaminated by scene 0's failure
  const s1 = sceneStates.get(1);
  assert.ok(s1, 'scene 1 present');
  assert.equal(s1.status, 'submitted');
  assert.equal(s1.error, undefined);

  // Simulate what batchMonitorOnce does with these per-scene states:
  // queue state has both jobs pending
  const queueState: BatchQueueState = {
    schemaVersion: 1,
    externalJobId,
    route: 'runway-useapi',
    outputDir: outDir,
    workspaceRoot: root,
    submittedAt: '2026-05-29T00:00:00.000Z',
    jobs: [
      { id: 'job-alpha', sceneIndex: 0, taskId: 't0', status: 'pending' },
      { id: 'job-bravo', sceneIndex: 1, taskId: 't1', status: 'pending' },
    ],
  };

  // Apply per-scene attribution (mirrors batchMonitorOnce logic)
  for (const job of queueState.jobs) {
    if (job.status === 'done' || job.status === 'failed') continue;
    const scene = sceneStates.get(job.sceneIndex);
    if (scene?.status === 'failed') {
      job.status = 'failed';
      if (scene.error) job.error = scene.error;
    }
    // submitted/absent → remain pending
  }

  // job 0 failed with its own specific error message
  assert.equal(queueState.jobs[0].status, 'failed');
  assert.equal(queueState.jobs[0].error, 'scene 0 exploded');

  // job 1 remains pending — NOT failed just because a sibling failed
  assert.equal(queueState.jobs[1].status, 'pending');
  assert.equal(queueState.jobs[1].error, undefined);

  // rollup: 1 failed, 1 pending → NOT terminal
  const rollup = rollupBatchQueueState(queueState);
  assert.equal(rollup.failed, 1);
  assert.equal(rollup.pending, 1);
  assert.equal(rollup.done, 0);
  assert.equal(rollup.terminal, false);
});
