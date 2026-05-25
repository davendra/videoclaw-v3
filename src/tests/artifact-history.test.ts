import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBriefArtifact } from '../video/artifacts.js';
import { buildArtifactHistoryReport } from '../video/artifact-history.js';
import { listArtifactHistory, writeArtifact } from '../video/artifact-store.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

describe('artifact history', () => {
  it('records snapshot history on repeated artifact writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-history-'));
    try {
      const workspace = await ensureProjectWorkspace('launch-teaser', root);
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Launch Teaser',
        intent: 'First intent',
        productionMode: 'storyboard',
      }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      await writeArtifact(workspace, 'brief', createBriefArtifact({
        title: 'Launch Teaser',
        intent: 'Second intent',
        productionMode: 'storyboard',
      }));

      const history = await listArtifactHistory(workspace, 'brief');
      assert.equal(history.length, 2);

      const report = await buildArtifactHistoryReport('launch-teaser', 'brief', root);
      assert.equal(report.historyFiles.length, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
