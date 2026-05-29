import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

describe('vclaw studio cli', () => {
  it('prints JSON plan when stdout is piped', () => {
    const r = spawnSync(process.execPath, [
      cliPath,
      'studio',
      '--dry-run',
      '--goal',
      'presenter-video',
      '--project',
      'demo',
      '--input',
      'deck.pdf',
      '--client',
      'Acme',
    ], { encoding: 'utf-8' });

    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout) as { goal: string; steps: Array<{ command: string }> };
    assert.equal(payload.goal, 'presenter-video');
    assert.ok(payload.steps.some((step) => step.command.includes('assemble')));
  });

  it('accepts short aliases for common goals', () => {
    const r = spawnSync(process.execPath, [
      cliPath,
      'studio',
      '--dry-run',
      '--goal',
      'presenter',
      '--project',
      'demo',
      '--input',
      'deck.pdf',
    ], { encoding: 'utf-8' });

    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout) as { goal: string };
    assert.equal(payload.goal, 'presenter-video');
  });

  it('returns a plan with missing inputs rather than throwing for incomplete goals', () => {
    const r = spawnSync(process.execPath, [
      cliPath,
      'studio',
      '--dry-run',
      '--goal',
      'copy-reference',
      '--project',
      'demo',
    ], { encoding: 'utf-8' });

    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout) as { missingInputs: string[] };
    assert.deepEqual(payload.missingInputs, ['input', 'intent']);
  });

  it('loads existing project context into warnings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cli-studio-'));
    const init = spawnSync(process.execPath, [
      cliPath,
      'video',
      'init',
      'demo',
      '--root',
      root,
    ], { encoding: 'utf-8' });
    assert.equal(init.status, 0, init.stderr);

    const r = spawnSync(process.execPath, [
      cliPath,
      'studio',
      '--dry-run',
      '--goal',
      'existing-project',
      '--project',
      'demo',
      '--root',
      root,
    ], { encoding: 'utf-8' });

    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout) as { warnings: string[]; steps: Array<{ command: string }> };
    assert.ok(payload.steps.some((step) =>
      step.command.startsWith('vclaw video status --project demo') && step.command.includes(`--root ${root}`),
    ));
    assert.ok(payload.warnings.some((warning) => warning.includes('Project next action')));
  });

  it('writes a session artifact when requested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cli-studio-session-'));
    const r = spawnSync(process.execPath, [
      cliPath,
      'studio',
      '--dry-run',
      '--goal',
      'presenter-video',
      '--project',
      'demo',
      '--input',
      'deck.pdf',
      '--root',
      root,
      '--write-session',
    ], { encoding: 'utf-8' });

    assert.equal(r.status, 0, r.stderr);
    const payload = JSON.parse(r.stdout) as { artifactPath: string };
    assert.ok(payload.artifactPath.endsWith('projects/demo/artifacts/studio-session.json'));
    const saved = JSON.parse(await readFile(payload.artifactPath, 'utf-8')) as { plan: { goal: string } };
    assert.equal(saved.plan.goal, 'presenter-video');
  });

  it('schema lists studio', () => {
    const r = spawnSync(process.execPath, [cliPath, 'schema', '--json'], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    const dump = JSON.parse(r.stdout) as { commands: Array<{ name: string }> };
    assert.ok(dump.commands.some((command) => command.name === 'studio'));
  });
});
