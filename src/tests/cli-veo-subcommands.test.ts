import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

describe('vclaw veo dispatch', () => {
  it('vclaw veo (no verb) exits 1 with missing_required_flag', () => {
    const r = spawnSync(process.execPath, [cliPath, 'veo'], { encoding: 'utf-8' });
    assert.equal(r.status, 1);
    const payload = JSON.parse(r.stdout) as { code: string };
    assert.equal(payload.code, 'missing_required_flag');
  });

  it('schema lists all 6 standard veo verbs', () => {
    const r = spawnSync(process.execPath, [cliPath, 'schema', '--json'], { encoding: 'utf-8' });
    assert.equal(r.status, 0);
    const dump = JSON.parse(r.stdout) as { commands: Array<{ name: string }> };
    const names = new Set(dump.commands.map((c) => c.name));
    for (const verb of ['veo status', 'veo list', 'veo history', 'veo resume', 'veo reset', 'veo cancel']) {
      assert.ok(names.has(verb), `schema should list '${verb}'`);
    }
  });
});
