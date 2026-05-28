import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact, createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { generateFilmmakingPrompts } from '../video/filmmaking-prompts.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

describe('vclaw storyboard-grid cli', () => {
  it('renders the default storyboard-grid asset and updates prompt packets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-storyboard-grid-cli-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'CLI Grid',
        intent: 'A compact cinematic beat.',
        productionMode: 'director',
      }));
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'director',
        scenes: [{
          sceneIndex: 0,
          description: 'A lead character turns into a rain-lit alley',
        }],
      }));
      await generateFilmmakingPrompts({
        root,
        projectSlug: 'alpha',
        write: true,
      });

      const result = spawnSync(process.execPath, [
        cliPath,
        'video',
        'storyboard-grid',
        '--project',
        'alpha',
        '--root',
        root,
        '--width',
        '960',
        '--height',
        '540',
      ], { encoding: 'utf-8' });

      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        outputPath?: string;
        artifactReferencePath?: string;
        panelCount?: number;
      };
      assert.equal(payload.artifactReferencePath, 'assets/storyboard-grid.png');
      assert.equal(payload.panelCount, 9);
      assert.ok(payload.outputPath?.endsWith('projects/alpha/assets/storyboard-grid.png'));

      const saved = await readFile(join(root, 'projects', 'alpha', 'artifacts', 'filmmaking-prompts.json'), 'utf-8');
      assert.match(saved, /"role": "storyboard-grid"/);
      assert.match(saved, /"status": "ready"/);
      assert.match(saved, /assets\/storyboard-grid\.png/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
