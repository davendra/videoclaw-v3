import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildSchemaDump } from '../video/cli-schema.js';

describe('cli-schema', () => {
  it('buildSchemaDump returns the v3 contract envelope', () => {
    const dump = buildSchemaDump();
    assert.equal(typeof dump.version, 'string', 'version present');
    assert.ok(Array.isArray(dump.commands), 'commands is an array');
    assert.equal(dump.commands.length, 70, 'expect exactly 70 curated commands; update this count when adding/removing entries');
    const names = dump.commands.map((c) => c.name);
    const uniqueNames = new Set(names);
    assert.equal(uniqueNames.size, names.length, 'command names must be unique');
    assert.ok(Array.isArray(dump.errorCodes), 'errorCodes is an array');
    assert.ok(dump.errorCodes.length >= 20, 'at least 20 error codes');
    assert.deepEqual(Object.keys(dump.exitCodes).sort(), ['GATE', 'SUCCESS', 'SYSTEM_ERROR', 'USER_ERROR']);
    assert.equal(typeof dump.artifactSchemas, 'object');
    assert.ok('brief' in dump.artifactSchemas, 'brief schema embedded');
    assert.ok('storyboard' in dump.artifactSchemas, 'storyboard schema embedded');
  });

  it('every command has at least a name and a usage string', () => {
    const dump = buildSchemaDump();
    for (const cmd of dump.commands) {
      assert.equal(typeof cmd.name, 'string', `command missing name: ${JSON.stringify(cmd)}`);
      assert.equal(typeof cmd.usage, 'string', `command ${cmd.name} missing usage`);
    }
  });

  it('`vclaw schema --json` end-to-end returns parseable JSON', () => {
    const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
    const result = spawnSync(process.execPath, [cliPath, 'schema', '--json'], {
      encoding: 'utf-8',
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as { version: string; commands: unknown[] };
    assert.equal(typeof parsed.version, 'string');
    assert.ok(Array.isArray(parsed.commands));
  });
});
