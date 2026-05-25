import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAnalyzeOutput } from '../video/analyze-output.js';
import { writeArtifact } from '../video/artifact-store.js';
import { buildClonePlan, listTemplates, readTemplate, saveTemplateFromAnalyzeOutput, validateTemplate } from '../video/template-store.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

describe('template store', () => {
  it('saves a template from analyze output and builds a clone plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-template-store-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      const analyze = createAnalyzeOutput({
        reference: { source: 'https://example.com/ref.mp4', title: 'Reference Ad' },
        pacing: { label: 'fast', notes: ['quick hook'] },
        structure: { beats: ['hook', 'demo', 'cta'] },
        motionClassification: { primaryMode: 'motion-clips', notes: ['moving footage'] },
        keep: ['hook energy'],
        change: ['topic'],
        reusableVariables: ['product', 'audience'],
        styleLayers: ['creator close-up', 'fast hand demo'],
        beatCompression: {
          targetDurationSeconds: 15,
          maxBeats: 3,
          dialogueWordBudget: 35,
          notes: ['compress proof into one visual beat'],
        },
        technicalNotes: ['vertical framing'],
        dialogueNotes: ['short hook line'],
      });
      await writeArtifact(workspace, 'analyze-output', analyze);

      const saved = await saveTemplateFromAnalyzeOutput({
        root,
        projectSlug: 'alpha',
        templateName: 'launch-template',
      });
      assert.ok(saved.outputPath.endsWith('launch-template.json'));

      const templateList = await listTemplates(root);
      assert.deepEqual(templateList, ['launch-template']);

      const template = await readTemplate('launch-template', root);
      assert.equal(template?.name, 'launch-template');
      assert.equal(template?.pacing.label, 'fast');
      assert.deepEqual(template?.styleLayers, ['creator close-up', 'fast hand demo']);
      assert.equal(template?.beatCompression?.dialogueWordBudget, 35);
      assert.ok(template?.workflowChecklist?.some((item) => item.includes('Replace product')));

      const validation = await validateTemplate('launch-template', root);
      assert.equal(validation.valid, true);
      assert.deepEqual(validation.issues, []);

      const clonePlan = await buildClonePlan({
        root,
        templateName: 'launch-template',
        projectSlug: 'beta',
        intent: 'Make a launch teaser for a smart bottle.',
      });
      assert.equal(clonePlan.templateName, 'launch-template');
      assert.equal(clonePlan.projectSlug, 'beta');
      assert.deepEqual(clonePlan.beats, ['hook', 'demo', 'cta']);
      assert.deepEqual(clonePlan.styleLayers, ['creator close-up', 'fast hand demo']);
      assert.equal(clonePlan.beatCompression?.targetDurationSeconds, 15);
      assert.ok(clonePlan.workflowChecklist?.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
