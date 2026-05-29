#!/usr/bin/env node
// check-artifact-schema-coverage.mjs
//
// Asserts every artifact written by src/video/**/*.ts has a matching schema
// in schemas/video/artifacts/, and every schema has a writer. Per
// MERGE_PLAN.md Addendum B6.
//
// MODES:
//   default (advisory) — prints any drift but always exits 0. Safe to wire
//     into release-readiness-lite. Use for current v2 state where some
//     canonical artifacts are written via paths other than the typed
//     writeArtifact() helper.
//   --strict — exits 1 on drift. Use once every writer has been audited
//     and either ported to writeArtifact() OR explicitly allowlisted.
//
// KNOWN ALLOWLIST: schemas in schemas/video/artifacts/ that are typed
// as canonical artifacts but whose writers do NOT yet go through the
// `writeArtifact(workspace, '<name>', ...)` helper. They're real
// product artifacts; the helper just isn't the only write path yet.
// Each one is a real to-do — fix-up route is in MERGE_PLAN.md A2.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const STRICT = process.argv.includes('--strict');

const KNOWN_ALTERNATE_WRITERS = new Set([
  // Each of these has a real writer somewhere in src/video/, just not
  // via the typed writeArtifact() helper. Audit pass needed before
  // promoting to writeArtifact() OR documenting the alternate API.
  'analyze-output',
  'clone-plan',
  'execution-plan',
  'publish-report',
  'reference-sheets',
  'review-report',
  'scene-candidates',
  'scene-selection',
  // Written via writeArtifact() in src/cli/vclaw.ts handleVideoMultiShot
  // (--auto --project path). The WRITER_RE only scans src/video/**/*.ts.
  'multi-shot-prompt',
  // Input-only artifact: operators hand-author artifacts/product-references.json
  // to anchor the product-subject filmmaking branch. Read by
  // src/video/product-references.ts; videoclaw never writes it.
  'product-references',
]);

const REPO_ROOT = process.cwd();
const SRC_VIDEO = join(REPO_ROOT, 'src', 'video');
const SCHEMAS_DIR = join(REPO_ROOT, 'schemas', 'video', 'artifacts');

// Matches `writeArtifact(workspace, 'artifact-name', ...)` — first string
// literal argument after the workspace identifier. Allows both single and
// double quotes.
const WRITER_RE = /writeArtifact\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*['"]([a-z][a-z0-9-]*)['"]/g;

function walkTs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkTs(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const writerNames = new Set();
const writerSources = new Map(); // name -> first file:line where seen

for (const filePath of walkTs(SRC_VIDEO)) {
  const content = readFileSync(filePath, 'utf-8');
  let m;
  while ((m = WRITER_RE.exec(content)) !== null) {
    const name = m[1];
    writerNames.add(name);
    if (!writerSources.has(name)) {
      const lineNumber = content.slice(0, m.index).split('\n').length;
      writerSources.set(name, `${relative(REPO_ROOT, filePath)}:${lineNumber}`);
    }
  }
}

const schemaNames = new Set();
for (const name of readdirSync(SCHEMAS_DIR)) {
  if (name.endsWith('.schema.json')) {
    schemaNames.add(name.replace(/\.schema\.json$/, ''));
  }
}

const writersWithoutSchema = [...writerNames].filter((n) => !schemaNames.has(n)).sort();
const allOrphanSchemas = [...schemaNames].filter((n) => !writerNames.has(n)).sort();
const orphanSchemas = allOrphanSchemas.filter((n) => !KNOWN_ALTERNATE_WRITERS.has(n));
const allowlistedOrphans = allOrphanSchemas.filter((n) => KNOWN_ALTERNATE_WRITERS.has(n));

let violations = 0;
let warnings = 0;

if (writersWithoutSchema.length > 0) {
  console.error('ERROR: writers without schemas (artifact emitted but no JSON Schema in schemas/video/artifacts/):');
  for (const name of writersWithoutSchema) {
    console.error(`  - ${name}  (first writer: ${writerSources.get(name)} ; expected schemas/video/artifacts/${name}.schema.json)`);
    violations++;
  }
}

if (orphanSchemas.length > 0) {
  console.error('ERROR: orphan schemas (no writer in src/video/**/*.ts emits this artifact, and not in the known-alternate-writer allowlist):');
  for (const name of orphanSchemas) {
    console.error(`  - ${name}  (schemas/video/artifacts/${name}.schema.json exists; add a writeArtifact() call OR add to KNOWN_ALTERNATE_WRITERS with a comment OR delete the schema)`);
    violations++;
  }
}

if (allowlistedOrphans.length > 0) {
  console.error('NOTE: schemas with alternate writers (allowlisted; audit pass pending):');
  for (const name of allowlistedOrphans) {
    console.error(`  - ${name}  (schema exists; writer not via writeArtifact() — flagged for audit per MERGE_PLAN.md A2)`);
    warnings++;
  }
}

console.error('');
const matched = writerNames.size;
console.error(`artifact-schema-coverage: ${matched} typed writer(s) match schemas; ${warnings} schema(s) on alternate-writer allowlist; ${violations} unexpected drift(s).`);

if (violations > 0) {
  if (STRICT) {
    console.error('--strict: failing on drift.');
    process.exit(1);
  }
  console.error('(advisory mode — exiting 0; rerun with --strict to fail builds on drift.)');
}
