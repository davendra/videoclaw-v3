import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
}

/**
 * Minimal structural validation against the draft-07 assemble-report schema
 * (no Ajv — no new deps). Checks top-level required keys, the status enum, and
 * each manifest item's required keys + kind enum.
 */
async function assertMatchesAssembleSchema(report: Record<string, unknown>) {
  const schema = JSON.parse(
    await readFile(
      join(process.cwd(), 'schemas', 'video', 'artifacts', 'assemble-report.schema.json'),
      'utf-8',
    ),
  ) as {
    required: string[];
    properties: {
      status: { enum: string[] };
      manifest: { items: { required: string[]; properties: { kind: { enum: string[] } } } };
    };
  };

  for (const key of schema.required) {
    assert.ok(key in report, `report missing required key "${key}"`);
  }
  assert.ok(
    schema.properties.status.enum.includes(report.status as string),
    `status "${report.status as string}" not in enum`,
  );
  const items = report.manifest as Array<Record<string, unknown>>;
  const itemReq = schema.properties.manifest.items.required;
  const kindEnum = schema.properties.manifest.items.properties.kind.enum;
  for (const item of items) {
    for (const key of itemReq) {
      assert.ok(key in item, `manifest item missing "${key}"`);
    }
    assert.ok(kindEnum.includes(item.kind as string), `manifest kind "${item.kind as string}" not in enum`);
  }
}

describe('vclaw video assemble (CLI)', () => {
  it('plans the pipeline on --dry-run and writes a schema-valid assemble-report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cli-assemble-'));
    try {
      const setup = [
        ['video', 'init', 'asm', '--root', root],
        ['video', 'brief', '--project', 'asm', '--root', root, '--title', 'Asm', '--intent', 'Assemble CLI test.'],
        ['video', 'storyboard', '--project', 'asm', '--root', root, '--scene', 'Open shot.', '--scene', 'Reveal.', '--scene', 'Sign-off.'],
      ];
      for (const args of setup) {
        const r = run(args);
        assert.equal(r.status, 0, `setup failed: ${args.join(' ')}\n${r.stderr}`);
      }

      const result = run(['video', 'assemble', '--project', 'asm', '--root', root, '--dry-run']);
      assert.equal(result.status, 0, `assemble failed:\n${result.stderr}`);

      const payload = JSON.parse(result.stdout) as {
        slug: string;
        artifactPath: string;
        status: string;
        manifest: Array<{ kind: string }>;
        events: string[];
      };
      assert.equal(payload.slug, 'asm');
      assert.equal(payload.status, 'dry-run');

      const kinds = payload.manifest.map((e) => e.kind);
      assert.ok(kinds.includes('narration'), 'plan includes narration');
      assert.ok(kinds.includes('slide-animation'), 'plan includes slide-animation');
      assert.ok(kinds.includes('final-video'), 'plan includes final-video');
      assert.ok(
        kinds.lastIndexOf('slide-animation') < kinds.indexOf('final-video'),
        'final-video planned after animations',
      );

      // Artifact written + schema-valid.
      assert.ok(existsSync(payload.artifactPath), 'assemble-report.json on disk');
      const report = JSON.parse(await readFile(payload.artifactPath, 'utf-8')) as Record<string, unknown>;
      await assertMatchesAssembleSchema(report);
      assert.equal(report.projectSlug, 'asm');
      assert.equal(report.status, 'dry-run');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exits 1 with missing_required_flag when --project is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-cli-assemble-noflag-'));
    try {
      const result = run(['video', 'assemble', '--root', root, '--dry-run']);
      assert.equal(result.status, 1, 'exit code 1 (user error)');
      const payload = JSON.parse(result.stdout) as { code: string };
      assert.equal(payload.code, 'missing_required_flag');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
