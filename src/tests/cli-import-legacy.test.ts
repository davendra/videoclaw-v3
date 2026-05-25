import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw import-legacy cli', () => {
  it('imports legacy project folders into clean project manifests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-import-root-'));
    const source = await mkdtemp(join(tmpdir(), 'vclaw-import-source-'));
    try {
      const legacyProject = join(source, 'legacy-alpha');
      await mkdir(join(legacyProject, 'images'), { recursive: true });
      await writeFile(join(legacyProject, 'images', 'scene_00_frame.png'), 'frame');
      await mkdir(join(legacyProject, 'legacy-alpha', 'videos'), { recursive: true });
      await writeFile(join(legacyProject, 'legacy-alpha', 'videos', 'clip_01.mp4'), 'video');
      await writeFile(join(legacyProject, 'seedance_queue.json'), JSON.stringify({
        scenes: [{ status: 'pending' }],
      }, null, 2));
      await writeFile(join(legacyProject, 'manifest.json'), JSON.stringify({ slug: 'legacy-alpha' }, null, 2));

      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const importResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'import-legacy', '--source', source, '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(importResult.status, 0, importResult.stderr);
      const payload = JSON.parse(importResult.stdout) as { results?: Array<{ slug?: string; imported?: boolean; summaryPath?: string }> };
      assert.equal(payload.results?.length, 1);
      assert.equal(payload.results?.[0]?.slug, 'legacy-alpha');
      assert.equal(payload.results?.[0]?.imported, true);

      const manifest = JSON.parse(await readFile(join(root, 'projects', 'legacy-alpha', 'project.json'), 'utf-8')) as {
        currentStage?: string | null;
        lastCompletedStage?: string | null;
        tags?: string[];
      };
      assert.equal(manifest.currentStage, 'review');
      assert.equal(manifest.lastCompletedStage, 'assets');
      assert.ok(manifest.tags?.includes('legacy-import'));
      assert.ok(manifest.tags?.includes('legacy-image'));
      assert.ok(manifest.tags?.includes('legacy-manifest'));
      assert.ok(manifest.tags?.includes('legacy-nested-output'));
      assert.ok(manifest.tags?.includes('legacy-queue-drift'));

      const summary = JSON.parse(await readFile(payload.results?.[0]?.summaryPath!, 'utf-8')) as {
        manifestPresent?: boolean;
        queueFilePresent?: boolean;
        queuePendingStatusDetected?: boolean;
        queueStatusMismatch?: boolean;
        nestedVideoCount?: number;
        nestedOutputRootDetected?: boolean;
      };
      assert.equal(summary.manifestPresent, true);
      assert.equal(summary.queueFilePresent, true);
      assert.equal(summary.queuePendingStatusDetected, true);
      assert.equal(summary.queueStatusMismatch, true);
      assert.equal(summary.nestedVideoCount, 1);
      assert.equal(summary.nestedOutputRootDetected, true);

      const eventsRaw = await readFile(join(root, 'projects', 'legacy-alpha', 'events', 'events.jsonl'), 'utf-8');
      assert.match(eventsRaw, /project\.legacy-imported/);
      assert.match(eventsRaw, /"queuePendingStatusDetected":true/);
      assert.match(eventsRaw, /"nestedVideoCount":1/);
      assert.match(eventsRaw, /"inferredCurrentStage":"review"/);
      assert.match(eventsRaw, /"inferredLastCompletedStage":"assets"/);

      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'legacy-alpha', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(statusResult.status, 0, statusResult.stderr);
      const statusPayload = JSON.parse(statusResult.stdout) as {
        nextStage?: string | null;
        completedStages?: string[];
        pendingStages?: string[];
      };
      assert.equal(statusPayload.nextStage, 'review');
      assert.deepEqual(statusPayload.completedStages, ['brief', 'storyboard', 'assets']);
      assert.deepEqual(statusPayload.pendingStages, ['review', 'publish']);

      const indexResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'index', '--root', root],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(indexResult.status, 0, indexResult.stderr);
      const indexPayload = JSON.parse(indexResult.stdout) as {
        index?: {
          projects?: Array<{ slug?: string; opsStatus?: string }>;
        };
      };
      assert.equal(indexPayload.index?.projects?.[0]?.slug, 'legacy-alpha');
      assert.equal(indexPayload.index?.projects?.[0]?.opsStatus, 'needs-review');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(source, { recursive: true, force: true });
    }
  });
});
