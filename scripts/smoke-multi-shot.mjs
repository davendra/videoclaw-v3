#!/usr/bin/env node
// Plan→validate round-trip across every registered multi-shot preset.
// No network, no Gemini — fixture-driven and runnable offline.

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');

const PRESETS = [
  { name: 'cinematic-15s', fixture: 'references/video/.fixtures/multi-shot-valid.txt' },
  { name: 'seedance-10s',  fixture: 'references/video/.fixtures/multi-shot-seedance-10s.txt' },
  { name: 'veo-8s',        fixture: 'references/video/.fixtures/multi-shot-veo-8s.txt' },
  { name: 'runway-10s',    fixture: 'references/video/.fixtures/multi-shot-runway-10s.txt' },
];

function run(args, opts = {}) {
  const res = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
    ...opts,
  });
  if (res.status !== 0) {
    console.error(`FAILED: vclaw ${args.join(' ')}`);
    console.error(`stderr: ${res.stderr}`);
    console.error(`stdout: ${res.stdout}`);
    process.exit(1);
  }
  return res.stdout;
}

for (const { name, fixture } of PRESETS) {
  if (!existsSync(fixture)) {
    console.error(`missing fixture for ${name}: ${fixture}`);
    process.exit(1);
  }

  const planJson = run(['video', 'multi-shot', '--plan', '--preset', name, '--seed', '1']);
  const planPath = join(tmpdir(), `ms-plan-${name}.json`);
  writeFileSync(planPath, planJson);

  const validateOut = run(['video', 'multi-shot', '--validate', '--preset', name, '--file', fixture]);
  const parsed = JSON.parse(validateOut);
  if (!parsed.valid) {
    console.error(`FAILED: ${name} validate not valid: ${JSON.stringify(parsed.issues)}`);
    process.exit(1);
  }

  console.log(`ok ${name} — plan=${planPath} validate=valid charCount=${parsed.charCount}`);
}

console.log(`\nall ${PRESETS.length} presets passed plan→validate round-trip.`);
