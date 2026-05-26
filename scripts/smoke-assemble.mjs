#!/usr/bin/env node
// smoke-assemble.mjs — integration smoke for `vclaw video assemble` (dry-run).
//
// init -> brief -> storyboard (fixture) -> assemble --dry-run, asserting the
// dry-run plan threads the whole pipeline (tts -> animate -> stitch) and that
// the assemble-report artifact is written. The smoke NEVER needs ffmpeg or any
// API key — dry-run plans every command + provider call without executing it.
// Real ffmpeg/key-requiring assembly is a HUMAN integration checkpoint.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = await mkdtemp(join(tmpdir(), 'vclaw-assemble-smoke-'));
const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

function run(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`command failed (${result.status}): ${args.join(' ')}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

try {
  run(['video', 'init', 'asm', '--root', root]);
  run([
    'video', 'brief', '--project', 'asm', '--root', root,
    '--title', 'Assemble Smoke', '--intent', 'Validate assemble dry-run pipeline.',
  ]);
  run([
    'video', 'storyboard', '--project', 'asm', '--root', root,
    '--scene', 'Hook shot of the product on a clean desk.',
    '--scene', 'Feature reveal with the host narrating.',
    '--scene', 'Call to action and sign-off.',
  ]);

  const assemble = run(['video', 'assemble', '--project', 'asm', '--root', root, '--dry-run']);

  // --- assertions ---
  assert.equal(assemble.status, 'dry-run', 'status must be dry-run');
  assert.ok(Array.isArray(assemble.manifest), 'manifest is an array');
  assert.ok(Array.isArray(assemble.events), 'events is an array');

  const kinds = assemble.manifest.map((e) => e.kind);
  assert.ok(kinds.includes('narration'), 'plan includes narration (TTS) stage');
  assert.ok(kinds.includes('slide-animation'), 'plan includes slide-animation stage');
  assert.ok(kinds.includes('final-video'), 'plan includes final-video (stitch) stage');

  // Pipeline ORDER: narration + slide-animation are planned before the final
  // stitched video.
  const lastAnimate = kinds.lastIndexOf('slide-animation');
  const finalVideo = kinds.indexOf('final-video');
  assert.ok(finalVideo > lastAnimate, 'final-video must be planned after the slide animations');

  // Events thread the ffmpeg plan (stitch) without execution.
  assert.ok(
    assemble.events.some((e) => e.startsWith('stitch.plan:')),
    'events record the stitch ffmpeg plan (dry-run)',
  );

  // The assemble-report artifact was written via the typed writer.
  assert.ok(typeof assemble.artifactPath === 'string', 'artifactPath returned');
  assert.ok(existsSync(assemble.artifactPath), 'assemble-report.json exists on disk');
  const report = JSON.parse(await readFile(assemble.artifactPath, 'utf-8'));
  assert.equal(report.projectSlug, 'asm', 'report carries the project slug');
  assert.equal(report.status, 'dry-run', 'report status is dry-run');
  assert.ok(Array.isArray(report.manifest) && report.manifest.length > 0, 'report manifest populated');
  assert.ok(typeof report.generatedAt === 'string', 'report has generatedAt');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    root,
    status: assemble.status,
    stages: kinds,
    artifactPath: assemble.artifactPath,
  }, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
