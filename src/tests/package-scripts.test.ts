import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

describe('package verification scripts', () => {
  it('exposes the expected smoke and guardrail scripts in package.json', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf-8'),
    ) as {
      scripts?: Record<string, string>;
    };

    const scripts = packageJson.scripts ?? {};
    assert.equal(scripts['smoke:runtime'], 'npm run build && node scripts/smoke-runtime.mjs');
    assert.equal(scripts['smoke:native-veo'], 'npm run build && node scripts/smoke-native-veo.mjs');
    assert.equal(scripts['smoke:character-hydration'], 'npm run build && node scripts/smoke-character-hydration.mjs');
    assert.equal(scripts['smoke:execution-cancel'], 'npm run build && node scripts/smoke-execution-cancel.mjs');
    assert.equal(scripts['smoke:portfolio'], 'npm run build && node scripts/smoke-portfolio.mjs');
    assert.equal(scripts['check:movie-director-wrappers'], 'bash scripts/check-movie-director-wrappers.sh');
    assert.equal(scripts['check:cleanroom-docs'], 'bash scripts/check-cleanroom-docs.sh');
    assert.equal(scripts['check:skill-frontdoor'], 'bash scripts/check-skill-frontdoor.sh');
    assert.equal(scripts['check:release-readiness-lite'], 'bash scripts/check-release-readiness-lite.sh');
  });

  it('ships the referenced helper scripts on disk', async () => {
    const requiredPaths = [
      'scripts/smoke-runtime.mjs',
      'scripts/smoke-native-veo.mjs',
      'scripts/smoke-character-hydration.mjs',
      'scripts/smoke-execution-cancel.mjs',
      'scripts/smoke-portfolio.mjs',
      'scripts/check-movie-director-wrappers.sh',
      'scripts/check-cleanroom-docs.sh',
      'scripts/check-skill-frontdoor.sh',
      'scripts/check-release-readiness-lite.sh',
    ];

    for (const relativePath of requiredPaths) {
      const absolutePath = join(process.cwd(), relativePath);
      await access(absolutePath, constants.F_OK);
    }
  });

  it('keeps the image-storyboard e2e smoke isolated by default', async () => {
    const script = await readFile(
      join(process.cwd(), 'scripts', 'e2e-image-storyboard-workflow.mjs'),
      'utf-8',
    );

    assert.match(script, /mkdtemp/);
    assert.match(script, /vclaw-image-storyboard-e2e-/);
    assert.match(script, /const root = args\.root \?\?/);
  });

  it('includes the isolated image-storyboard e2e in release-readiness-lite', async () => {
    const script = await readFile(
      join(process.cwd(), 'scripts', 'check-release-readiness-lite.sh'),
      'utf-8',
    );

    assert.match(
      script,
      /node scripts\/e2e-image-storyboard-workflow\.mjs --verify-server/,
    );
  });

  it('blocks local absolute checkout paths in clean-room-facing docs', async () => {
    const script = await readFile(
      join(process.cwd(), 'scripts', 'check-cleanroom-docs.sh'),
      'utf-8',
    );

    assert.match(script, /\/Users\/davendrapatel/);
    assert.match(script, /README\.md/);
    assert.match(script, /Cannot find module/);
    assert.match(script, /MODULE_NOT_FOUND/);
  });

  it('keeps the shipped quickstart cast on the successful demo path', async () => {
    const cast = await readFile(
      join(process.cwd(), 'docs', 'assets', 'demo-quickstart.cast'),
      'utf-8',
    );

    assert.match(cast, /"command":"node scripts\/demo-quickstart\.mjs"/);
    assert.match(cast, /"x", "0"/);
    assert.doesNotMatch(cast, /command failed|Cannot find module|MODULE_NOT_FOUND/);
  });

  it('guards generated verification artifacts from the release source diff', async () => {
    const script = await readFile(
      join(process.cwd(), 'scripts', 'check-release-readiness-lite.sh'),
      'utf-8',
    );

    assert.match(script, /git check-ignore -q -- "\$path"/);
    assert.match(script, /outputs\/smoke-result\.json/);
    assert.match(script, /\.playwright-mcp\/session\.json/);
    assert.match(script, /vclaw-review-ui-desktop-after-stage-gate\.png/);
    assert.match(script, /vclaw-review-ui-mobile-after-stage-gate\.png/);
    assert.match(script, /projects\/example\/outputs\/final\.mp4/);
  });

  it('keeps operator quickstarts clear about local and installed CLI paths', async () => {
    const readme = await readFile(join(process.cwd(), 'README.md'), 'utf-8');
    const productionWorkflow = await readFile(
      join(process.cwd(), 'docs', 'PRODUCTION_WORKFLOW.md'),
      'utf-8',
    );
    const operatorHandoff = await readFile(
      join(process.cwd(), 'docs', 'OPERATOR_HANDOFF.md'),
      'utf-8',
    );
    const releaseReadiness = await readFile(
      join(process.cwd(), 'docs', 'RELEASE_READINESS.md'),
      'utf-8',
    );

    assert.match(readme, /These commands are for a source checkout/);
    assert.match(readme, /replace\s+`node dist\/cli\/vclaw\.js`\s+with\s+`vclaw`/);
    assert.match(releaseReadiness, /source checkout/);
    assert.match(releaseReadiness, /installed-package users should run the same check as `vclaw video plan --project <slug>`/);
    assert.match(releaseReadiness, /`vclaw video sync-obsidian`/);
    assert.match(productionWorkflow, /# Choose one review path\./);
    assert.match(productionWorkflow, /review-autopilot` is\s+the non-interactive counterpart/);
    assert.match(productionWorkflow, /video-release-readiness/);
    assert.match(productionWorkflow, /Installed users should see `vclaw \.\.\.` examples/);
    assert.match(productionWorkflow, /OPERATOR_HANDOFF\.md/);
    assert.match(operatorHandoff, /Installed CLI examples use `vclaw`/);
    assert.match(operatorHandoff, /replace `vclaw` with `node dist\/cli\/vclaw\.js`/);
    assert.match(operatorHandoff, /metrics\.publishReady: true/);
    assert.match(operatorHandoff, /npm pack --dry-run --json/);
    assert.match(releaseReadiness, /video-portfolio-ops/);
  });

  it('keeps lifecycle docs aligned to canonical Review UI handoff truth', async () => {
    const architecture = await readFile(join(process.cwd(), 'docs', 'ARCHITECTURE.md'), 'utf-8');
    const operations = await readFile(join(process.cwd(), 'docs', 'OPERATIONS.md'), 'utf-8');
    const cliReference = await readFile(join(process.cwd(), 'docs', 'CLI_REFERENCE.md'), 'utf-8');

    for (const content of [architecture, operations, cliReference]) {
      assert.match(content, /review-ui/);
      assert.match(content, /review-autopilot/);
      assert.match(content, /metrics\.publishReady: true/);
    }

    assert.match(operations, /video review --verdict pass` only when equivalent review evidence already exists/);
    assert.match(cliReference, /The simple `review --verdict pass` path is for projects\s+that already have equivalent review evidence/);
  });

  it('ships production workflow skills for Review UI, portfolio, and release handoff', async () => {
    const catalog = JSON.parse(
      await readFile(join(process.cwd(), 'skills', 'catalog.json'), 'utf-8'),
    ) as {
      skills?: Array<{ id?: string; specializes?: string; role?: string }>;
    };
    const readme = await readFile(join(process.cwd(), 'skills', 'README.md'), 'utf-8');
    const workflowSkills = [
      {
        id: 'video-production-handoff',
        requiredPatterns: [
          /review-report\.json/,
          /metrics\.publishReady: true/,
          /vclaw video review-ui --project <slug>/,
          /vclaw video review-autopilot --project <slug>/,
          /npm run check:release-readiness-lite/,
        ],
      },
      {
        id: 'video-review-ui-qa',
        requiredPatterns: [
          /Review UI QA/,
          /vclaw video review-ui --project <slug>/,
          /vclaw video review-autopilot --project <slug>/,
          /metrics\.publishReady: true/,
          /node --test dist\/tests\/review-ui\.test\.js dist\/tests\/cli-review-ui\.test\.js/,
        ],
      },
      {
        id: 'video-portfolio-ops',
        requiredPatterns: [
          /vclaw video metrics/,
          /vclaw video next-actions/,
          /vclaw video doctor-portfolio/,
          /vclaw video export-csv/,
          /reviewPublishReady/,
        ],
      },
      {
        id: 'video-release-readiness',
        requiredPatterns: [
          /npm run check:release-readiness-lite/,
          /npm pack --dry-run --json/,
          /git diff --check/,
          /node dist\/cli\/vclaw\.js video providers/,
          /vclaw video providers/,
        ],
      },
    ];

    for (const workflowSkill of workflowSkills) {
      const catalogEntry = catalog.skills?.find((entry) => entry.id === workflowSkill.id);
      const skill = await readFile(join(process.cwd(), 'skills', workflowSkill.id, 'SKILL.md'), 'utf-8');

      assert.equal(catalogEntry?.specializes, 'video-framework');
      assert.equal(catalogEntry?.role, 'specialist');
      assert.match(readme, new RegExp(workflowSkill.id));
      for (const pattern of workflowSkill.requiredPatterns) {
        assert.match(skill, pattern, `${workflowSkill.id} should document ${pattern}`);
      }
    }
  });

  it('publishes the bundled Review UI asset used by the CLI default', async () => {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), 'package.json'), 'utf-8'),
    ) as {
      files?: string[];
    };

    assert.deepEqual(packageJson.files, [
      'AGENTS.md',
      'CLAUDE.md',
      'LICENSE',
      'README.md',
      'tsconfig.json',
      'docs/*.md',
      'docs/assets/*',
      'dist/cli/',
      'dist/mcp/',
      'dist/video/',
      'dist/index.d.ts',
      'dist/index.d.ts.map',
      'dist/index.js',
      'dist/index.js.map',
      'schemas/',
      'src/video/',
      'playbooks/',
      'references/',
      'skills/README.md',
      'skills/catalog.json',
      'skills/*/assets/*',
      'skills/*/README.md',
      'skills/*/SKILL.md',
      'tmp/review-station/index.html',
    ]);
    await access(join(process.cwd(), 'tmp', 'review-station', 'index.html'), constants.F_OK);
  });

  it('keeps compiled tests out of the npm package while shipping the Review UI asset', () => {
    const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout) as Array<{ files?: Array<{ path?: string }> }>;
    const paths = new Set((payload[0]?.files ?? []).map((entry) => entry.path).filter(Boolean));

    assert.ok(paths.has('dist/cli/vclaw.js'));
    assert.ok(paths.has('dist/video/review-ui.js'));
    assert.ok(paths.has('dist/index.js'));
    assert.ok(paths.has('tmp/review-station/index.html'));
    assert.ok(paths.has('README.md'));
    assert.ok(paths.has('LICENSE'));
    assert.ok(paths.has('package.json'));
    assert.ok(paths.has('docs/CLI_REFERENCE.md'));
    assert.ok(paths.has('docs/MIGRATION.md'));
    assert.ok(paths.has('docs/OPERATOR_HANDOFF.md'));
    assert.ok(paths.has('docs/PRODUCTION_WORKFLOW.md'));
    assert.ok(paths.has('docs/PUBLISHING.md'));
    assert.ok(paths.has('docs/assets/logo.jpg'));
    assert.ok(paths.has('docs/assets/demo-quickstart.gif'));
    assert.ok(paths.has('docs/assets/demo-quickstart.cast'));
    assert.ok(paths.has('tsconfig.json'));
    assert.ok(paths.has('src/video/scene-candidates.ts'));
    assert.ok(paths.has('src/video/reference-sheets.ts'));
    assert.ok(paths.has('skills/catalog.json'));
    assert.ok(paths.has('skills/davendra-presenter/assets/davendra_intro_1.jpg'));
    assert.ok(paths.has('skills/nex-presenter/assets/nex_intro_1.jpg'));
    assert.ok(paths.has('skills/video-framework/SKILL.md'));
    assert.ok(paths.has('skills/video-production-handoff/SKILL.md'));
    assert.ok(paths.has('skills/video-review-ui-qa/SKILL.md'));
    assert.ok(paths.has('skills/video-portfolio-ops/SKILL.md'));
    assert.ok(paths.has('skills/video-release-readiness/SKILL.md'));
    assert.ok(paths.has('AGENTS.md'));
    assert.ok(paths.has('CLAUDE.md'));
    assert.ok(![...paths].some((path) => path?.startsWith('dist/tests/')));
    assert.ok(![...paths].some((path) => path?.startsWith('src/tests/')));
    assert.ok(![...paths].some((path) => path?.includes('__pycache__')));
    assert.ok(![...paths].some((path) => path?.startsWith('projects/')));
    assert.ok(![...paths].some((path) => path?.endsWith('.tgz')));
  });
});
