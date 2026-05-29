import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudioPlan } from '../video/studio/planner.js';

describe('buildStudioPlan', () => {
  it('builds a presenter plan without executing anything', () => {
    const plan = buildStudioPlan({
      goal: 'presenter-video',
      project: 'demo',
      input: 'deck.pdf',
      client: 'Acme',
      dryRun: true,
      root: process.cwd(),
    });

    assert.equal(plan.schemaVersion, 1);
    assert.equal(plan.goal, 'presenter-video');
    assert.equal(plan.dryRun, true);
    assert.equal(plan.missingInputs.length, 0);
    assert.ok(plan.steps.some((step) => step.command === 'vclaw video assemble --project demo --dry-run'));
    assert.ok(plan.steps.some((step) => step.command.includes('--client Acme')));
  });

  it('reports missing required inputs instead of guessing', () => {
    const plan = buildStudioPlan({
      goal: 'copy-reference',
      project: 'demo',
      dryRun: true,
      root: process.cwd(),
    });

    assert.deepEqual(plan.missingInputs, ['input', 'intent']);
    assert.equal(plan.steps.length, 0);
    assert.match(plan.nextAction, /Provide input and intent/);
  });

  it('defaults to existing-project when no goal is supplied but a project is supplied', () => {
    const plan = buildStudioPlan({
      project: 'demo',
      dryRun: true,
      root: process.cwd(),
    });

    assert.equal(plan.goal, 'existing-project');
    assert.ok(plan.steps.some((step) => step.command === 'vclaw video status --project demo'));
  });

  it('builds music-video plans with prompt packet, readiness, execute, review, and multi-shot steps', () => {
    const plan = buildStudioPlan({
      goal: 'music-video',
      project: 'dhuaan',
      durationSeconds: 60,
      dryRun: true,
      root: process.cwd(),
    });

    assert.equal(plan.goal, 'music-video');
    assert.ok(plan.steps.some((step) => step.command.includes('filmmaking-prompts')));
    assert.ok(plan.steps.some((step) => step.command.includes('multi-shot')));
    assert.ok(plan.steps.some((step) => step.command.includes('readiness')));
    assert.ok(plan.steps.some((step) => step.command.includes('execute')));
    assert.ok(plan.steps.some((step) => step.command.includes('portal')));
    assert.ok(plan.warnings.some((warning) => warning.includes('provider credits')));
  });
});
