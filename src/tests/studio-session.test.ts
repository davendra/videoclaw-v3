import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStudioPlan } from '../video/studio/planner.js';
import { writeStudioSession } from '../video/studio/session.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

describe('studio session artifact', () => {
  it('writes studio-session.json into project artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-studio-session-'));
    await ensureProjectWorkspace('demo', root);
    const plan = buildStudioPlan({
      goal: 'presenter-video',
      project: 'demo',
      input: 'deck.pdf',
      client: 'Acme',
      dryRun: true,
      root,
    });

    const path = await writeStudioSession(root, 'demo', plan);
    assert.ok(path.endsWith('projects/demo/artifacts/studio-session.json'));
    const saved = JSON.parse(await readFile(path, 'utf-8')) as { plan: { goal: string } };
    assert.equal(saved.plan.goal, 'presenter-video');
  });
});
