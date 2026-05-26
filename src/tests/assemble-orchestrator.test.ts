import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureProjectWorkspace } from '../video/workspace.js';
import { writeArtifact } from '../video/artifact-store.js';
import { assembleProject, writeAssembleReport } from '../video/assemble/assemble.js';
import { createStoryboardArtifact } from '../video/artifacts.js';

async function fixtureWorkspace(slug: string) {
  const root = await mkdtemp(join(tmpdir(), 'vclaw-assemble-orch-'));
  const workspace = await ensureProjectWorkspace(slug, root);
  const storyboard = createStoryboardArtifact({
    projectSlug: slug,
    productionMode: 'storyboard',
    scenes: [
      { sceneIndex: 0, description: 'Hook shot.', dialogue: 'Watch this.', scenePrompt: { imagePrompt: 'a clean desk' } },
      { sceneIndex: 1, description: 'Reveal.', dialogue: 'Here is the product in action today.' },
      { sceneIndex: 2, description: 'Sign-off.', dialogue: 'Subscribe for more.' },
    ],
  });
  await writeArtifact(workspace, 'storyboard', storyboard);
  return { root, workspace };
}

describe('assemble orchestrator (dry-run)', () => {
  it('plans the whole pipeline IN ORDER without executing anything', async () => {
    const { root, workspace } = await fixtureWorkspace('orch');
    try {
      const result = await assembleProject({ workspace, dryRun: true });

      assert.equal(result.status, 'dry-run', 'status is dry-run');

      const kinds = result.manifest.map((e) => e.kind);
      assert.ok(kinds.includes('narration'), 'includes narration (TTS)');
      assert.ok(kinds.includes('slide-animation'), 'includes slide-animation');
      assert.ok(kinds.includes('final-video'), 'includes final-video (stitch)');

      // Order: every slide-animation is planned before the final stitched video.
      const lastAnimate = kinds.lastIndexOf('slide-animation');
      const finalVideo = kinds.indexOf('final-video');
      assert.ok(finalVideo > lastAnimate, 'final-video planned after slide animations');

      // One narration + one segment per scene (3 scenes).
      assert.equal(kinds.filter((k) => k === 'narration').length, 3);
      assert.equal(kinds.filter((k) => k === 'slide-animation').length, 3);
      assert.equal(kinds.filter((k) => k === 'final-video').length, 1);

      // Events thread the stitch ffmpeg plan WITHOUT execution.
      assert.ok(
        result.events.some((e) => e.startsWith('stitch.plan:')),
        'events record stitch ffmpeg plan',
      );

      // No real execution: nothing was written to the output path on dry-run.
      assert.ok(!existsSync(result.outputPath), 'no final.mp4 written on dry-run');
      // Segment/audio dirs are not created on dry-run either.
      assert.ok(!existsSync(join(workspace.projectDir, 'assemble', 'segments')), 'no segments dir');
      assert.ok(!existsSync(join(workspace.projectDir, 'assemble', 'audio')), 'no audio dir');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs advisory QA and surfaces it without throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-assemble-qa-'));
    try {
      const workspace = await ensureProjectWorkspace('qa', root);
      const longLine = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
      await writeArtifact(
        workspace,
        'storyboard',
        createStoryboardArtifact({
          projectSlug: 'qa',
          productionMode: 'storyboard',
          scenes: [{ sceneIndex: 0, description: longLine, dialogue: longLine }],
        }),
      );
      const result = await assembleProject({ workspace, dryRun: true });
      // dry-run keeps status dry-run; QA warnings still collected.
      assert.equal(result.status, 'dry-run');
      assert.ok(result.warnings.length > 0, 'over-long dialogue produces QA warnings');
      assert.ok(result.warnings.some((w) => w.startsWith('qa.')), 'QA-namespaced warnings present');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writeAssembleReport persists a schema-shaped assemble-report via the typed writer', async () => {
    const { root, workspace } = await fixtureWorkspace('report');
    try {
      const result = await assembleProject({ workspace, dryRun: true });
      const { artifactPath, report } = await writeAssembleReport(workspace, result);

      assert.ok(existsSync(artifactPath), 'assemble-report.json written');
      assert.ok(artifactPath.endsWith(join('artifacts', 'assemble-report.json')));

      // Schema-required fields present.
      assert.equal(report.projectSlug, 'report');
      assert.equal(report.status, 'dry-run');
      assert.ok(typeof report.generatedAt === 'string');
      assert.ok(Array.isArray(report.manifest) && report.manifest.length > 0);
      for (const entry of report.manifest) {
        for (const key of ['kind', 'path', 'durationMs', 'sizeBytes', 'generator']) {
          assert.ok(key in entry, `manifest entry has ${key}`);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
