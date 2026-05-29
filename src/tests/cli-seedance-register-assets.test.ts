import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

// Env with SUTUI_API_KEY stripped so the key-guard path is exercised offline.
function envWithoutKey(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.SUTUI_API_KEY;
  return env;
}

function run(args: string[], env = envWithoutKey()) {
  return spawnSync(process.execPath, [cliPath, 'video', 'seedance-register-assets', ...args], { encoding: 'utf-8', env });
}

describe('vclaw seedance-register-assets cli (offline guards)', () => {
  it('errors without --project', () => {
    const r = run([]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /requires --project/);
  });

  it('errors when no --character is given', () => {
    const r = run(['--project', 'demo']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /at least one --character/);
  });

  it('rejects a --character without a <name>:<imageUrl> shape', () => {
    const r = run(['--project', 'demo', '--character', 'Meera']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--character must be <name>:<imageUrl>/);
  });

  it('rejects a --character whose image is not a public http(s) URL', () => {
    const r = run(['--project', 'demo', '--character', 'Meera:/local/path.jpg']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /must be a public http\(s\) URL/);
  });

  it('requires SUTUI_API_KEY before any network call', () => {
    const r = run(['--project', 'demo', '--character', 'Meera:https://r2.example/meera.jpg']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /requires SUTUI_API_KEY/);
  });
});
