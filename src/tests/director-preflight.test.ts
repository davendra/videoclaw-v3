import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStoryboardArtifact } from '../video/artifacts.js';
import { writeArtifact } from '../video/artifact-store.js';
import { addCharacterProfile } from '../video/characters.js';
import {
  applyContentFilterSubstitutions,
  checkGoBananasCharacterIds,
  checkContentFilterHazards,
  checkDistinctScenes,
  checkDialogueFit,
  checkPronounConsistency,
  checkReferenceSheetGbRefs,
  checkReferenceSheetRoleCollisions,
  checkReferenceSheetValidation,
  runDirectorPreflight,
} from '../video/director-preflight.js';
import { ensureProjectWorkspace } from '../video/workspace.js';

describe('director-preflight', () => {
  it('flags provider-risk content hazards as errors', () => {
    const issues = checkContentFilterHazards({
      scenes: [{ sceneIndex: 0, description: 'Komo raises a spectral blade over the city.' }],
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.severity, 'error');
    assert.match(issues[0]?.message ?? '', /provider-risk wording/i);
  });

  it('flags adjacent near-duplicate scenes as warnings', () => {
    const issues = checkDistinctScenes({
      scenes: [
        { sceneIndex: 0, description: 'Nova sprints through rain across the neon alley toward the tower.' },
        { sceneIndex: 1, description: 'Nova sprints through rain across the neon alley toward the tower again.' },
      ],
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.severity, 'warn');
  });

  it('warns when dialogue cannot fit the scene duration', () => {
    const issues = checkDialogueFit({
      scenes: [{
        sceneIndex: 0,
        description: 'Creator talks to camera.',
        durationSeconds: 5,
        dialogue: 'This is a long spoken explanation that clearly needs more than five seconds to deliver at a natural pace.',
      }],
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.code, 'DIALOGUE_DURATION_OVERFLOW');
    assert.equal(issues[0]?.severity, 'warn');
  });

  it('flags pronoun drift against known character descriptions', () => {
    const issues = checkPronounConsistency(
      {
        scenes: [{
          sceneIndex: 0,
          description: 'Nova moves through the corridor while he checks his gear and he watches the exit.',
          characters: ['Nova'],
        }],
      },
      [{
        id: 'nova',
        name: 'Nova',
        description: 'A determined woman in a silver jacket.',
        referenceAssets: ['refs/nova.png'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.severity, 'warn');
    assert.match(issues[0]?.message ?? '', /pronoun drift/i);
  });

  it('applies deterministic content substitutions', () => {
    const result = applyContentFilterSubstitutions(
      'Hiro raises a spectral blade and fires a gun while the body shatters.',
    );
    assert.ok(result.changes >= 2);
    assert.doesNotMatch(result.text, /spectral blade/i);
    assert.doesNotMatch(result.text, /fires a gun/i);
    assert.doesNotMatch(result.text, /body shatters/i);
  });

  it('flags missing Go Bananas ids and missing reference images', async () => {
    const issues = await checkGoBananasCharacterIds(
      [
        {
          id: 'nova',
          name: 'Nova',
          goBananasId: 170,
          referenceAssets: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'ghost',
          name: 'Ghost',
          goBananasId: 404,
          referenceAssets: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      'token',
      'https://example.test/api',
      async (url: string | URL | Request) => {
        const value = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (value.endsWith('/170')) {
          return new Response(JSON.stringify({ data: { reference_images: [] } }), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      },
    );
    assert.ok(issues.some((issue) => issue.code === 'CHAR_NO_REF_IMAGE'));
    assert.ok(issues.some((issue) => issue.code === 'CHAR_ID_NOT_FOUND'));
  });

  it('runs the project-level preflight and combines warnings/errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-director-preflight-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      await addCharacterProfile(workspace, {
        name: 'Nova',
        description: 'A determined woman in a silver jacket.',
        referenceAssets: ['https://example.test/nova.png'],
      });
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'alpha',
        productionMode: 'director',
        scenes: [
          {
            sceneIndex: 0,
            description: 'Nova raises a spectral blade while he checks his gear.',
            characters: ['Nova'],
          },
          {
            sceneIndex: 1,
            description: 'Nova raises a spectral blade while he checks his gear again.',
            characters: ['Nova'],
          },
        ],
      }));

      const result = await runDirectorPreflight('alpha', root, {
        fetcher: async () => ({ ok: false, status: 404 } as Response),
      });

      assert.equal(result.pass, false);
      assert.ok(result.errors.some((issue) => issue.code === 'CONTENT_FILTER_HAZARD'));
      assert.ok(result.errors.some((issue) => issue.code === 'REF_IMAGE_UNREACHABLE'));
      assert.ok(result.warnings.some((issue) => issue.code === 'PRONOUN_DRIFT'));
      assert.ok(result.warnings.some((issue) => issue.code === 'SCENE_REPEAT'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('flags prompt-quality issues as warnings by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-director-preflight-'));
    try {
      const workspace = await ensureProjectWorkspace('pq', root);
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'pq',
        productionMode: 'director',
        scenes: [
          {
            sceneIndex: 0,
            description: 'A tall, mysterious, charismatic, weathered, sun-kissed, stoic figure stands still.',
          },
        ],
      }));

      const result = await runDirectorPreflight('pq', root, {
        fetcher: async () => new Response('ok', { status: 200 }),
      });

      assert.ok(result.warnings.some((i) => i.code === 'prompt-quality-adjective-soup'));
      assert.ok(!result.errors.some((i) => i.code === 'prompt-quality-adjective-soup'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('promotes prompt-quality issues to blocking errors under DIRECTOR_STRICT_PROMPT_QUALITY=1', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-director-preflight-'));
    const previous = process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
    process.env.DIRECTOR_STRICT_PROMPT_QUALITY = '1';
    try {
      const workspace = await ensureProjectWorkspace('pq-strict', root);
      await writeArtifact(workspace, 'storyboard', createStoryboardArtifact({
        projectSlug: 'pq-strict',
        productionMode: 'director',
        scenes: [
          {
            sceneIndex: 0,
            description: 'A tall, mysterious, charismatic, weathered, sun-kissed, stoic figure stands still.',
          },
        ],
      }));

      const result = await runDirectorPreflight('pq-strict', root, {
        fetcher: async () => new Response('ok', { status: 200 }),
      });

      assert.equal(result.pass, false);
      assert.ok(result.errors.some((i) => i.code === 'prompt-quality-adjective-soup'));
    } finally {
      if (previous === undefined) {
        delete process.env.DIRECTOR_STRICT_PROMPT_QUALITY;
      } else {
        process.env.DIRECTOR_STRICT_PROMPT_QUALITY = previous;
      }
      await rm(root, { recursive: true, force: true });
    }
  });

  it('flags role-vocabulary-violation and unassigned-role from the reference-sheets artifact', () => {
    const issues = checkReferenceSheetValidation({
      schemaVersion: 1,
      sheets: [
        {
          id: 'sheet-001',
          type: 'identity',
          name: 'bad-vocab',
          references: [
            { path: 'refs/a.png', role: 'palette' as never },
          ],
          bindings: { sceneIndices: [0] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'sheet-002',
          type: 'identity',
          name: 'missing-role',
          references: [
            { path: 'refs/b.png' } as never,
          ],
          bindings: { sceneIndices: [0] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    assert.ok(issues.some((issue) => issue.code === 'role-vocabulary-violation' && issue.severity === 'error'));
    assert.ok(issues.some((issue) => issue.code === 'unassigned-role' && issue.severity === 'error'));
  });

  it('flags role-collision when two sheets supply the same role on one scene', () => {
    const issues = checkReferenceSheetRoleCollisions({
      schemaVersion: 1,
      sheets: [
        {
          id: 'sheet-001',
          type: 'palette-mood',
          name: 'A',
          references: [{ path: 'refs/a.png', role: 'palette' }],
          bindings: { sceneIndices: [1] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'sheet-002',
          type: 'palette-mood',
          name: 'B',
          references: [{ path: 'refs/b.png', role: 'palette' }],
          bindings: { sceneIndices: [1] },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.code, 'role-collision');
    assert.equal(issues[0]?.severity, 'error');
    assert.match(issues[0]?.message ?? '', /scene 1: role=palette/);
  });

  it('does not probe GB refs when GO_BANANAS_API_KEY is absent', async () => {
    const issues = await checkReferenceSheetGbRefs(
      {
        schemaVersion: 1,
        sheets: [
          {
            id: 'sheet-001',
            type: 'identity',
            name: 'x',
            references: [{ gbRef: { kind: 'character', id: 170 }, role: 'identity' }],
            bindings: { sceneIndices: [0] },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      undefined,
      'https://example.test/api',
    );
    assert.deepEqual(issues, []);
  });

  it('flags reference-sheet-orphan-gb-ref when a gbRef character id returns 404', async () => {
    const issues = await checkReferenceSheetGbRefs(
      {
        schemaVersion: 1,
        sheets: [
          {
            id: 'sheet-001',
            type: 'identity',
            name: 'x',
            references: [{ gbRef: { kind: 'character', id: 404 }, role: 'identity' }],
            bindings: { sceneIndices: [0] },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      'token',
      'https://example.test/api',
      async () => new Response('not found', { status: 404 }),
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.code, 'reference-sheet-orphan-gb-ref');
    assert.equal(issues[0]?.severity, 'error');
  });

  it('emits a pending TODO warning for non-character gbRef kinds', async () => {
    const issues = await checkReferenceSheetGbRefs(
      {
        schemaVersion: 1,
        sheets: [
          {
            id: 'sheet-001',
            type: 'palette-mood',
            name: 'x',
            references: [{ gbRef: { kind: 'style-preset', id: 77 }, role: 'palette' }],
            bindings: { sceneIndices: [0] },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      'token',
      'https://example.test/api',
      async () => new Response('{}', { status: 200 }),
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.code, 'reference-sheet-gb-ref-probe-pending');
    assert.equal(issues[0]?.severity, 'warn');
  });
});
