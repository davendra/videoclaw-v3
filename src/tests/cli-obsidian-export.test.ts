import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('vclaw export-obsidian cli', () => {
  it('exports an Obsidian-ready markdown note for a project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-obsidian-'));
    const outputDir = join(root, 'vault', 'Projects');
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const commands = [
        ['video', 'create', 'A lonely astronaut discovers an alien flower on Mars.', '--project', 'launch-teaser', '--root', root, '--production-mode', 'director', '--runtime', '1:30', '--clip-duration', '10'],
        ['video', 'brief', '--project', 'launch-teaser', '--root', root, '--title', 'Launch Teaser', '--intent', 'Make a short launch teaser.', '--platform', 'tiktok', '--aspect-ratio', '9:16', '--quality', 'quality', '--resolution', '1080p', '--audio', 'off', '--outputs', '2'],
        ['video', 'character-add', '--project', 'launch-teaser', '--root', root, '--name', 'Nova', '--gb-id', '170', '--ref', 'refs/nova.png'],
        ['video', 'storyboard', '--project', 'launch-teaser', '--root', root, '--scene', 'Open with silhouette.', '--scene-character', '0:Nova'],
        ['video', 'storyboard-review', '--project', 'launch-teaser', '--root', root, '--mode', 'storyboard'],
        ['video', 'execution-plan', '--project', 'launch-teaser', '--root', root],
      ];

      for (const args of commands) {
        const result = spawnSync(process.execPath, [cliPath, ...args], {
          cwd: process.cwd(),
          encoding: 'utf-8',
        });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }
      await writeFile(
        join(root, 'projects', 'launch-teaser', 'state', 'legacy-import-summary.json'),
        JSON.stringify({
          sourcePath: '/tmp/legacy-launch-teaser',
          importedAt: '2026-04-21T10:00:00.000Z',
          imageCount: 1,
          videoCount: 0,
          finalCount: 0,
          telemetryCount: 0,
          manifestPresent: true,
          queueFilePresent: true,
          queuePendingStatusDetected: true,
          queueStatusMismatch: true,
          nestedVideoCount: 1,
          nestedFinalCount: 0,
          nestedOutputRootDetected: true,
          inferredCurrentStage: 'review',
          inferredLastCompletedStage: 'assets',
          inferredCheckpointStatus: 'completed',
        }, null, 2),
      );

      const exportResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'export-obsidian', '--project', 'launch-teaser', '--root', root, '--output-dir', outputDir],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(exportResult.status, 0);
      const payload = JSON.parse(exportResult.stdout) as { outputPath?: string };
      const note = await readFile(payload.outputPath!, 'utf-8');
      assert.match(note, /^---/);
      assert.match(note, /slug: "launch-teaser"/);
      assert.match(note, /target_runtime_seconds: 90/);
      assert.match(note, /clip_duration_seconds: 10/);
      assert.match(note, /genre: "sci-fi"/);
      assert.match(note, /platform: "tiktok"/);
      assert.match(note, /legacy_import_manifest_present: true/);
      assert.match(note, /legacy_import_queue_status_mismatch: true/);
      assert.match(note, /legacy_import_nested_output_root_detected: true/);
      assert.match(note, /# launch-teaser/);
      assert.match(note, /## Checkpoints/);
      assert.match(note, /- Target runtime: `90s`/);
      assert.match(note, /- Clip duration: `10s`/);
      assert.match(note, /- Genre: `sci-fi`/);
      assert.match(note, /- Platform: `tiktok`/);
      assert.match(note, /- Legacy import diagnostics: `manifest=true \| queue-file=true \| queue-drift=true \| nested-output=true`/);
      assert.match(note, /execution_profile_aspect_ratio: "9:16"/);
      assert.match(note, /storyboard_review_state:/);
      assert.match(note, /storyboard_review_exists:/);
      assert.match(note, /storyboard_review_path:/);
      assert.match(note, /storyboard_review_generated_at:/);
      assert.match(note, /storyboard_review_stale:/);
      assert.match(note, /storyboard\.md/);
      assert.match(note, /## Prompt Guidance/);
      assert.match(note, /character_bindings:/);
      assert.match(note, /Nova:170:refs\/nova\.png/);
      assert.match(note, /## Character Bindings/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes reference sheet frontmatter fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-obsidian-refsheet-'));
    const outputDir = join(root, 'vault', 'Projects');
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      for (const args of [
        ['video', 'init', 'demo', '--root', root, '--mode', 'director'],
        ['video', 'reference-sheet-add', '--project', 'demo', '--root', root, '--type', 'identity', '--name', 'Lead', '--ref', 'refs/a.png:identity', '--binding', '0'],
      ]) {
        const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: process.cwd(), encoding: 'utf-8' });
        assert.equal(result.status, 0, `command failed: ${args.join(' ')}\n${result.stderr}`);
      }

      const exportResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'export-obsidian', '--project', 'demo', '--root', root, '--output-dir', outputDir],
        { cwd: process.cwd(), encoding: 'utf-8' },
      );
      assert.equal(exportResult.status, 0);
      const payload = JSON.parse(exportResult.stdout) as { outputPath?: string };
      const note = await readFile(payload.outputPath!, 'utf-8');
      assert.match(note, /referenceSheetCount: 1/);
      assert.match(note, /referenceSheetTypes: "identity"/);
      assert.match(note, /referenceSheetCollisions: false/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
