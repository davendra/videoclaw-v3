import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('vclaw create cli', () => {
  it('creates a director project, scaffolds artifacts, and generates storyboard review output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'create',
          'Story X: Neo-Tokyo action thriller featuring Komo and Mochi.',
          '--root',
          root,
          '--project',
          'story-x',
          '--production-mode',
          'director',
          '--scenes',
          '4',
          '--style',
          'villeneuve',
          '--color-grading',
          'neon-noir',
          '--platform',
          'youtube',
          '--gb-character',
          'Komo:170',
          '--gb-character',
          'Mochi:247',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        slug?: string;
        sceneCount?: number;
        resolvedDefaults?: {
          genre?: string;
          platform?: string;
          style?: string;
          colorGrading?: string;
          targetRuntimeSeconds?: number;
          clipDurationSeconds?: number;
          sceneCount?: number;
        };
        review?: { markdownPath?: string };
        preflight?: { pass?: boolean; warnings?: Array<{ code?: string }> };
        costEstimate?: { totalUsd?: number; wallTimeMinutes?: number };
        handoff?: { reviewCommand?: string; approvalCommand?: string; verifyEnvCommand?: string };
        characterHydration?: {
          explicit?: Array<{ name?: string; goBananasId?: number }>;
          imported?: Array<{ name?: string; goBananasId?: number }>;
          autoCreated?: Array<{ name?: string; goBananasId?: number }>;
          final?: Array<{ name?: string; goBananasId?: number }>;
        };
        seedAssetManifestPath?: string;
      };

      const projectManifest = JSON.parse(
        await readFile(join(root, 'projects', 'story-x', 'project.json'), 'utf-8'),
      ) as { currentStage?: string | null; lastCheckpointStatus?: string };
      const briefArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'story-x', 'artifacts', 'brief.json'), 'utf-8'),
      ) as {
        metadata?: {
          style?: string;
          colorGrading?: string;
          goBananasCharacters?: Array<{ name?: string; goBananasId?: number }>;
        };
      };
      const storyboardArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'story-x', 'artifacts', 'storyboard.json'), 'utf-8'),
      ) as { scenes?: Array<{ characters?: string[]; durationSeconds?: number }> };
      const charactersStore = JSON.parse(
        await readFile(join(root, 'projects', 'story-x', 'characters', 'characters.json'), 'utf-8'),
      ) as { characters?: Array<{ name?: string; goBananasId?: number; referenceAssets?: string[] }> };
      const reviewMarkdown = await readFile(payload.review?.markdownPath!, 'utf-8');

      assert.equal(payload.slug, 'story-x');
      assert.equal(payload.sceneCount, 4);
      assert.equal(payload.resolvedDefaults?.genre, 'action-thriller');
      assert.equal(payload.resolvedDefaults?.platform, 'youtube');
      assert.equal(payload.resolvedDefaults?.style, 'villeneuve');
      assert.equal(payload.resolvedDefaults?.colorGrading, 'neon-noir');
      assert.equal(payload.resolvedDefaults?.targetRuntimeSeconds, undefined);
      assert.equal(payload.resolvedDefaults?.clipDurationSeconds, 15);
      assert.equal(payload.resolvedDefaults?.sceneCount, 4);
      assert.equal(payload.preflight?.pass, true);
      assert.equal(payload.costEstimate?.totalUsd, 1.67);
      assert.equal(payload.costEstimate?.wallTimeMinutes, 21);
      assert.deepEqual(payload.characterHydration?.explicit?.map((entry) => entry.goBananasId), [170, 247]);
      assert.deepEqual(payload.characterHydration?.final?.map((entry) => entry.goBananasId), [170, 247]);
      assert.match(payload.handoff?.verifyEnvCommand ?? '', /vclaw video verify-env --root /);
      assert.match(payload.handoff?.approvalCommand ?? '', /VIDEOCLAW_APPROVE_STORYBOARD=1 vclaw video execute --project "story-x" --root /);
      assert.match(payload.handoff?.reviewCommand ?? '', /vclaw video storyboard-review --project "story-x" --root /);
      assert.ok(!(payload.preflight?.warnings ?? []).some((warning) => warning.code === 'SCENE_REPEAT'));
      assert.equal(projectManifest.currentStage, 'storyboard');
      assert.equal(projectManifest.lastCheckpointStatus, 'awaiting-approval');
      assert.equal(briefArtifact.metadata?.style, 'villeneuve');
      assert.equal(briefArtifact.metadata?.colorGrading, 'neon-noir');
      assert.equal(briefArtifact.metadata?.goBananasCharacters?.length, 2);
      assert.equal(storyboardArtifact.scenes?.length, 4);
      assert.deepEqual(storyboardArtifact.scenes?.[0]?.characters, ['Komo', 'Mochi']);
      assert.deepEqual(storyboardArtifact.scenes?.[1]?.characters, ['Komo']);
      assert.deepEqual(storyboardArtifact.scenes?.[2]?.characters, ['Mochi']);
      assert.deepEqual(storyboardArtifact.scenes?.[3]?.characters, ['Komo', 'Mochi']);
      assert.equal(storyboardArtifact.scenes?.[0]?.durationSeconds, 15);
      assert.ok(charactersStore.characters?.some((entry) => entry.name === 'Komo' && entry.goBananasId === 170));
      assert.ok(charactersStore.characters?.some((entry) => entry.referenceAssets?.includes('gobananas://character/247')));
      assert.match(reviewMarkdown, /Storyboard Review/);
      assert.match(reviewMarkdown, /Komo/);
      assert.match(reviewMarkdown, /Mochi/);
      assert.match(reviewMarkdown, /villeneuve/);
      assert.match(reviewMarkdown, /\| Style \| villeneuve \|/);
      assert.match(reviewMarkdown, /\| Color grading \| neon-noir \|/);
      assert.match(reviewMarkdown, /## Cost Estimate/);
      assert.match(reviewMarkdown, /\| Total \| \$1\.67 \|/);
      assert.ok(payload.seedAssetManifestPath?.endsWith('asset-manifest.json'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('carries execution-profile overrides from create into brief and status surfaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const createResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'create',
          'A vertical cinematic teaser for a new product.',
          '--root',
          root,
          '--project',
          'profiled-create',
          '--production-mode',
          'director',
          '--scenes',
          '2',
          '--aspect-ratio',
          '9:16',
          '--quality',
          'fast',
          '--resolution',
          '1080p',
          '--audio',
          'off',
          '--outputs',
          '2',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(createResult.status, 0, createResult.stderr);

      const briefArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'profiled-create', 'artifacts', 'brief.json'), 'utf-8'),
      ) as {
        metadata?: {
          executionProfile?: {
            aspectRatio?: string;
            quality?: string;
            resolution?: string;
            generateAudio?: boolean;
            outputCount?: number;
          };
        };
      };

      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'profiled-create', '--root', root, '--mode', 'director'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(statusResult.status, 0, statusResult.stderr);
      const statusPayload = JSON.parse(statusResult.stdout) as {
        executionProfile?: {
          aspectRatio?: string;
          quality?: string;
          resolution?: string;
          generateAudio?: boolean;
          outputCount?: number;
        };
      };

      assert.equal(briefArtifact.metadata?.executionProfile?.aspectRatio, '9:16');
      assert.equal(briefArtifact.metadata?.executionProfile?.quality, 'fast');
      assert.equal(briefArtifact.metadata?.executionProfile?.resolution, '1080p');
      assert.equal(briefArtifact.metadata?.executionProfile?.generateAudio, false);
      assert.equal(briefArtifact.metadata?.executionProfile?.outputCount, 2);
      assert.equal(statusPayload.executionProfile?.aspectRatio, '9:16');
      assert.equal(statusPayload.executionProfile?.quality, 'fast');
      assert.equal(statusPayload.executionProfile?.resolution, '1080p');
      assert.equal(statusPayload.executionProfile?.generateAudio, false);
      assert.equal(statusPayload.executionProfile?.outputCount, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('derives a platform-aware aspect ratio when create receives a short-form platform without explicit overrides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const createResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'create',
          'A short-form vertical teaser.',
          '--root',
          root,
          '--project',
          'platform-default-create',
          '--production-mode',
          'director',
          '--scenes',
          '2',
          '--platform',
          'tiktok',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(createResult.status, 0, createResult.stderr);

      const briefArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'platform-default-create', 'artifacts', 'brief.json'), 'utf-8'),
      ) as {
        metadata?: {
          platform?: string;
          executionProfile?: {
            aspectRatio?: string;
          };
        };
      };

      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'platform-default-create', '--root', root, '--mode', 'director'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(statusResult.status, 0, statusResult.stderr);
      const statusPayload = JSON.parse(statusResult.stdout) as {
        executionProfile?: {
          aspectRatio?: string;
        };
      };

      assert.equal(briefArtifact.metadata?.platform, 'tiktok');
      assert.equal(briefArtifact.metadata?.executionProfile?.aspectRatio, '9:16');
      assert.equal(statusPayload.executionProfile?.aspectRatio, '9:16');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('infers director genre defaults and beat structure from the create intent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const createResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'create',
          'A lonely astronaut discovers an alien flower on Mars.',
          '--root',
          root,
          '--project',
          'mars-flower',
          '--production-mode',
          'director',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(createResult.status, 0, createResult.stderr);

      const payload = JSON.parse(createResult.stdout) as {
        genre?: string;
        sceneCount?: number;
        resolvedDefaults?: {
          genre?: string;
          platform?: string;
          style?: string;
          colorGrading?: string;
          targetRuntimeSeconds?: number;
          clipDurationSeconds?: number;
          sceneCount?: number;
        };
        review?: { markdownPath?: string };
      };
      const briefArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'mars-flower', 'artifacts', 'brief.json'), 'utf-8'),
      ) as {
        metadata?: {
          genre?: string;
          platform?: string;
          style?: string;
          colorGrading?: string;
          executionProfile?: { aspectRatio?: string };
        };
      };
      const storyboardArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'mars-flower', 'artifacts', 'storyboard.json'), 'utf-8'),
      ) as { scenes?: Array<{ description?: string; durationSeconds?: number }> };
      const reviewMarkdown = await readFile(payload.review?.markdownPath!, 'utf-8');

      assert.equal(payload.genre, 'sci-fi');
      assert.equal(payload.sceneCount, 14);
      assert.equal(payload.resolvedDefaults?.genre, 'sci-fi');
      assert.equal(payload.resolvedDefaults?.platform, 'youtube');
      assert.equal(payload.resolvedDefaults?.style, 'villeneuve');
      assert.equal(payload.resolvedDefaults?.colorGrading, 'teal-orange');
      assert.equal(payload.resolvedDefaults?.targetRuntimeSeconds, undefined);
      assert.equal(payload.resolvedDefaults?.clipDurationSeconds, 15);
      assert.equal(payload.resolvedDefaults?.sceneCount, 14);
      assert.equal(briefArtifact.metadata?.genre, 'sci-fi');
      assert.equal(briefArtifact.metadata?.platform, 'youtube');
      assert.equal(briefArtifact.metadata?.style, 'villeneuve');
      assert.equal(briefArtifact.metadata?.colorGrading, 'teal-orange');
      assert.equal(briefArtifact.metadata?.executionProfile?.aspectRatio, '16:9');
      assert.equal(storyboardArtifact.scenes?.[0]?.durationSeconds, 15);
      assert.match(storyboardArtifact.scenes?.[0]?.description ?? '', /world-establish/);
      assert.match(storyboardArtifact.scenes?.[0]?.description ?? '', /epic, awe, isolating/);
      assert.match(reviewMarkdown, /\| Genre \| sci-fi \|/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('derives director scene count from runtime when scenes are not explicitly provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const createResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'create',
          'A lonely astronaut discovers an alien flower on Mars.',
          '--root',
          root,
          '--project',
          'runtime-create',
          '--production-mode',
          'director',
          '--runtime',
          '1:30',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(createResult.status, 0, createResult.stderr);
      const payload = JSON.parse(createResult.stdout) as { sceneCount?: number; genre?: string };
      const storyboardArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'runtime-create', 'artifacts', 'storyboard.json'), 'utf-8'),
      ) as { scenes?: Array<{ durationSeconds?: number }> };

      assert.equal(payload.genre, 'sci-fi');
      assert.equal(payload.sceneCount, 6);
      assert.equal(storyboardArtifact.scenes?.length, 6);
      assert.equal(storyboardArtifact.scenes?.[0]?.durationSeconds, 15);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports overriding director clip duration for runtime planning and storyboard scene durations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const createResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'create',
          'A lonely astronaut discovers an alien flower on Mars.',
          '--root',
          root,
          '--project',
          'clip-duration-create',
          '--production-mode',
          'director',
          '--runtime',
          '1:30',
          '--clip-duration',
          '10',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(createResult.status, 0, createResult.stderr);
      const payload = JSON.parse(createResult.stdout) as {
        sceneCount?: number;
        resolvedDefaults?: { targetRuntimeSeconds?: number; clipDurationSeconds?: number };
        costEstimate?: { clipDurationSeconds?: number; totalUsd?: number };
      };
      const briefArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'clip-duration-create', 'artifacts', 'brief.json'), 'utf-8'),
      ) as {
        metadata?: {
          targetRuntimeSeconds?: number;
          clipDurationSeconds?: number;
        };
      };
      const storyboardArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'clip-duration-create', 'artifacts', 'storyboard.json'), 'utf-8'),
      ) as { scenes?: Array<{ durationSeconds?: number }> };

      assert.equal(payload.sceneCount, 9);
      assert.equal(payload.resolvedDefaults?.targetRuntimeSeconds, 90);
      assert.equal(payload.costEstimate?.clipDurationSeconds, 10);
      assert.equal(payload.costEstimate?.totalUsd, 2.55);
      assert.equal(briefArtifact.metadata?.targetRuntimeSeconds, 90);
      assert.equal(briefArtifact.metadata?.clipDurationSeconds, 10);
      assert.equal(storyboardArtifact.scenes?.length, 9);
      assert.equal(storyboardArtifact.scenes?.[0]?.durationSeconds, 10);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports the lightweight auto-mode wrapper for director create', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'auto',
          'A lonely astronaut discovers an alien flower on Mars.',
          '--root',
          root,
          '--project',
          'auto-mode',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        slug?: string;
        sceneCount?: number;
        genre?: string;
        resolvedDefaults?: {
          genre?: string;
          platform?: string;
          style?: string;
          colorGrading?: string;
          targetRuntimeSeconds?: number;
          clipDurationSeconds?: number;
          sceneCount?: number;
        };
        review?: { markdownPath?: string };
        handoff?: { approvalCommand?: string; reviewCommand?: string; verifyEnvCommand?: string };
      };
      const manifest = JSON.parse(
        await readFile(join(root, 'projects', 'auto-mode', 'project.json'), 'utf-8'),
      ) as { productionMode?: string; currentStage?: string; lastCheckpointStatus?: string };
      const briefArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'auto-mode', 'artifacts', 'brief.json'), 'utf-8'),
      ) as { metadata?: { genre?: string; style?: string; colorGrading?: string; platform?: string } };

      assert.equal(payload.slug, 'auto-mode');
      assert.equal(payload.genre, 'sci-fi');
      assert.equal(payload.sceneCount, 14);
      assert.equal(payload.resolvedDefaults?.genre, 'sci-fi');
      assert.equal(payload.resolvedDefaults?.platform, 'youtube');
      assert.equal(payload.resolvedDefaults?.style, 'villeneuve');
      assert.equal(payload.resolvedDefaults?.colorGrading, 'teal-orange');
      assert.equal(payload.resolvedDefaults?.targetRuntimeSeconds, undefined);
      assert.equal(payload.resolvedDefaults?.clipDurationSeconds, 15);
      assert.equal(payload.resolvedDefaults?.sceneCount, 14);
      assert.equal(manifest.productionMode, 'director');
      assert.equal(manifest.currentStage, 'storyboard');
      assert.equal(manifest.lastCheckpointStatus, 'awaiting-approval');
      assert.equal(briefArtifact.metadata?.genre, 'sci-fi');
      assert.equal(briefArtifact.metadata?.style, 'villeneuve');
      assert.equal(briefArtifact.metadata?.colorGrading, 'teal-orange');
      assert.equal(briefArtifact.metadata?.platform, 'youtube');
      assert.match(payload.handoff?.verifyEnvCommand ?? '', /vclaw video verify-env --root /);
      assert.match(payload.handoff?.approvalCommand ?? '', /VIDEOCLAW_APPROVE_STORYBOARD=1 vclaw video execute --project "auto-mode" --root /);
      assert.match(payload.handoff?.reviewCommand ?? '', /vclaw video storyboard-review --project "auto-mode" --root /);
      assert.match(payload.review?.markdownPath ?? '', /storyboard\.md$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports the lightweight iterate wrapper for director create and stops at the approval gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'iterate',
          'Refine the story pacing and make the midpoint feel more decisive.',
          '--root',
          root,
          '--project',
          'iterate-mode',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            USEAPI_API_TOKEN: 'test-token',
            USEAPI_ACCOUNT_EMAIL: 'test@example.com',
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        slug?: string;
        sceneCount?: number;
        execution?: { report?: { status?: string; blockers?: string[] } };
      };
      const manifest = JSON.parse(
        await readFile(join(root, 'projects', 'iterate-mode', 'project.json'), 'utf-8'),
      ) as { productionMode?: string; currentStage?: string; lastCheckpointStatus?: string };

      assert.equal(payload.slug, 'iterate-mode');
      assert.equal(payload.sceneCount, 14);
      assert.equal(payload.execution?.report?.status, 'blocked');
      assert.ok(payload.execution?.report?.blockers?.some((item) => item.includes('VIDEOCLAW_APPROVE_STORYBOARD=1')));
      assert.equal(manifest.productionMode, 'director');
      assert.equal(manifest.currentStage, 'storyboard');
      assert.equal(manifest.lastCheckpointStatus, 'awaiting-approval');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('lets auto-mode hand off into the existing execute path and stop at the approval gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'auto',
          'A lonely astronaut discovers an alien flower on Mars.',
          '--root',
          root,
          '--project',
          'auto-execute',
          '--execute',
          '--dry-run',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            USEAPI_API_TOKEN: 'test-token',
            USEAPI_ACCOUNT_EMAIL: 'test@example.com',
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        execution?: { report?: { status?: string; blockers?: string[] } };
      };
      const checkpoint = JSON.parse(
        await readFile(join(root, 'projects', 'auto-execute', 'checkpoints', 'storyboard.json'), 'utf-8'),
      ) as { status?: string };

      assert.equal(payload.execution?.report?.status, 'blocked');
      assert.ok(payload.execution?.report?.blockers?.some((item) => item.includes('VIDEOCLAW_APPROVE_STORYBOARD=1 vclaw video execute --project "auto-execute" --root')));
      assert.equal(checkpoint.status, 'awaiting-approval');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can hand off to the existing execute path and stop at the approval gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'create',
          'A cinematic launch spot for a smart bottle.',
          '--root',
          root,
          '--project',
          'smart-bottle',
          '--production-mode',
          'director',
          '--scenes',
          '3',
          '--execute',
          '--dry-run',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            USEAPI_API_TOKEN: 'test-token',
            USEAPI_ACCOUNT_EMAIL: 'test@example.com',
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        execution?: { report?: { status?: string; blockers?: string[] } };
      };
      const checkpoint = JSON.parse(
        await readFile(join(root, 'projects', 'smart-bottle', 'checkpoints', 'storyboard.json'), 'utf-8'),
      ) as { status?: string };

      assert.equal(payload.execution?.report?.status, 'blocked');
      assert.ok(payload.execution?.report?.blockers?.some((item) => item.includes('VIDEOCLAW_APPROVE_STORYBOARD=1')));
      assert.equal(checkpoint.status, 'awaiting-approval');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can hand off to the existing execute path and complete a director dry-run after approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'create',
          'A cinematic launch spot for a smart bottle.',
          '--root',
          root,
          '--project',
          'approved-smart-bottle',
          '--production-mode',
          'director',
          '--scenes',
          '3',
          '--execute',
          '--dry-run',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            USEAPI_API_TOKEN: 'test-token',
            USEAPI_ACCOUNT_EMAIL: 'test@example.com',
            VIDEOCLAW_APPROVE_STORYBOARD: '1',
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        execution?: { report?: { status?: string } };
      };

      const statusResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'status', '--project', 'approved-smart-bottle', '--root', root, '--mode', 'director'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(statusResult.status, 0, statusResult.stderr);
      const statusPayload = JSON.parse(statusResult.stdout) as {
        completedStages?: string[];
        nextStage?: string | null;
      };

      assert.equal(payload.execution?.report?.status, 'dry-run-complete');
      assert.ok(statusPayload.completedStages?.includes('assets'));
      assert.equal(statusPayload.nextStage, 'review');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports the lightweight approve wrapper for director execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const autoResult = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'auto',
          'A lonely astronaut discovers an alien flower on Mars.',
          '--root',
          root,
          '--project',
          'approve-mode',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(autoResult.status, 0, autoResult.stderr);
      await writeFile(
        join(root, '.env.local'),
        'USEAPI_API_TOKEN=test-token\nUSEAPI_ACCOUNT_EMAIL=test@example.com\n',
      );

      const approveResult = spawnSync(
        process.execPath,
        [cliPath, 'video', 'approve', '--project', 'approve-mode', '--root', root, '--dry-run'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
        },
      );
      assert.equal(approveResult.status, 0, approveResult.stderr);
      const payload = JSON.parse(approveResult.stdout) as {
        report?: { status?: string; dryRun?: boolean };
      };

      assert.equal(payload.report?.status, 'dry-run-complete');
      assert.equal(payload.report?.dryRun, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports the lightweight run-pipeline wrapper for director create plus execute handoff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    try {
      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = spawnSync(
        process.execPath,
        [
          cliPath,
          'video',
          'run-pipeline',
          'A lonely astronaut discovers an alien flower on Mars.',
          '--root',
          root,
          '--project',
          'pipeline-mode',
          '--dry-run',
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            USEAPI_API_TOKEN: 'test-token',
            USEAPI_ACCOUNT_EMAIL: 'test@example.com',
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout) as {
        slug?: string;
        sceneCount?: number;
        execution?: { report?: { status?: string; blockers?: string[] } };
      };
      const manifest = JSON.parse(
        await readFile(join(root, 'projects', 'pipeline-mode', 'project.json'), 'utf-8'),
      ) as { productionMode?: string; currentStage?: string; lastCheckpointStatus?: string };

      assert.equal(payload.slug, 'pipeline-mode');
      assert.equal(payload.sceneCount, 14);
      assert.equal(payload.execution?.report?.status, 'blocked');
      assert.ok(payload.execution?.report?.blockers?.some((item) => item.includes('VIDEOCLAW_APPROVE_STORYBOARD=1')));
      assert.equal(manifest.productionMode, 'director');
      assert.equal(manifest.currentStage, 'storyboard');
      assert.equal(manifest.lastCheckpointStatus, 'awaiting-approval');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can import library characters from the create intent when requested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/characters' || req.method !== 'GET') {
        res.writeHead(404).end();
        return;
      }
      const search = url.searchParams.get('search');
      const payload = (() => {
        if (search === 'komo') return [{ id: 170, character_name: 'Komo', description: 'Child hero with a determined stance.' }];
        if (search === 'mochi') return [{ id: 247, character_name: 'Mochi', description: 'Small fluffy white rabbit.' }];
        if (search === 'hiro') return [{ id: 206, character_name: 'Hiro', description: 'Stoic samurai ally.' }];
        return [];
      })();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: payload }));
    });

    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address unavailable');
      }

      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = await execFileAsync(
        process.execPath,
        [
          cliPath,
          'video',
          'create',
          'Komo and Mochi meet Hiro in Neo Tokyo.',
          '--root',
          root,
          '--project',
          'imported-cast',
          '--production-mode',
          'director',
          '--scenes',
          '3',
          '--import-library-characters',
          '--api-url',
          `http://127.0.0.1:${address.port}`,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            GO_BANANAS_API_KEY: 'token',
          },
        },
      );
      assert.doesNotMatch(result.stderr ?? '', /Unknown|Error:/);

      const payload = JSON.parse(result.stdout) as {
        characterHydration?: {
          imported?: Array<{ goBananasId?: number }>;
          final?: Array<{ goBananasId?: number }>;
        };
      };
      const briefArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'imported-cast', 'artifacts', 'brief.json'), 'utf-8'),
      ) as {
        metadata?: {
          goBananasCharacters?: Array<{ name?: string; goBananasId?: number }>;
        };
      };
      const charactersStore = JSON.parse(
        await readFile(join(root, 'projects', 'imported-cast', 'characters', 'characters.json'), 'utf-8'),
      ) as { characters?: Array<{ name?: string; goBananasId?: number }> };

      assert.deepEqual(payload.characterHydration?.imported?.map((entry) => entry.goBananasId), [170, 247, 206]);
      assert.deepEqual(payload.characterHydration?.final?.map((entry) => entry.goBananasId), [170, 247, 206]);
      assert.deepEqual(
        briefArtifact.metadata?.goBananasCharacters?.map((entry) => entry.goBananasId),
        [170, 247, 206],
      );
      assert.ok(charactersStore.characters?.some((entry) => entry.name === 'Komo' && entry.goBananasId === 170));
      assert.ok(charactersStore.characters?.some((entry) => entry.name === 'Mochi' && entry.goBananasId === 247));
      assert.ok(charactersStore.characters?.some((entry) => entry.name === 'Hiro' && entry.goBananasId === 206));
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
      await rm(root, { recursive: true, force: true });
    }
  });

  it('can auto-create missing characters during create from a seed file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-create-cli-'));
    const inputPath = join(root, 'character-seed.json');
    await writeFile(inputPath, JSON.stringify([
      {
        name: 'Nova',
        description: 'A determined spaceship captain with a silver jacket.',
        style: 'cinematic sci-fi still',
      },
    ], null, 2));

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/characters' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [] }));
        return;
      }
      if (url.pathname === '/images' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ url: 'https://cdn.example.test/nova.png' }));
        return;
      }
      if (url.pathname === '/upload-for-editing' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ image_id: 991 }));
        return;
      }
      if (url.pathname === '/characters' && req.method === 'POST') {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: { id: 555 } }));
        return;
      }
      res.writeHead(404).end();
    });

    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server address unavailable');
      }

      const cliPath = join(process.cwd(), 'dist', 'cli', 'vclaw.js');
      const result = await execFileAsync(
        process.execPath,
        [
          cliPath,
          'video',
          'create',
          'Nova leads the team through a sci-fi corridor.',
          '--root',
          root,
          '--project',
          'auto-created-cast',
          '--production-mode',
          'director',
          '--scenes',
          '3',
          '--auto-create-characters',
          inputPath,
          '--api-url',
          `http://127.0.0.1:${address.port}`,
        ],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          env: {
            ...process.env,
            GO_BANANAS_API_KEY: 'token',
          },
        },
      );
      assert.doesNotMatch(result.stderr ?? '', /Unknown|Error:/);

      const payload = JSON.parse(result.stdout) as {
        costEstimate?: { newCharacterCount?: number; goBananasTotalUsd?: number; totalUsd?: number };
        characterHydration?: {
          autoCreated?: Array<{ goBananasId?: number }>;
          final?: Array<{ goBananasId?: number }>;
        };
      };
      const briefArtifact = JSON.parse(
        await readFile(join(root, 'projects', 'auto-created-cast', 'artifacts', 'brief.json'), 'utf-8'),
      ) as {
        metadata?: {
          goBananasCharacters?: Array<{ name?: string; goBananasId?: number }>;
        };
      };
      const charactersStore = JSON.parse(
        await readFile(join(root, 'projects', 'auto-created-cast', 'characters', 'characters.json'), 'utf-8'),
      ) as { characters?: Array<{ name?: string; goBananasId?: number; referenceAssets?: string[] }> };

      assert.equal(payload.costEstimate?.newCharacterCount, 1);
      assert.equal(payload.costEstimate?.goBananasTotalUsd, 0.05);
      assert.equal(payload.costEstimate?.totalUsd, 1.31);
      assert.deepEqual(payload.characterHydration?.autoCreated?.map((entry) => entry.goBananasId), [555]);
      assert.deepEqual(payload.characterHydration?.final?.map((entry) => entry.goBananasId), [555]);
      assert.deepEqual(
        briefArtifact.metadata?.goBananasCharacters?.map((entry) => entry.goBananasId),
        [555],
      );
      assert.ok(charactersStore.characters?.some((entry) => entry.name === 'Nova' && entry.goBananasId === 555));
      assert.ok(charactersStore.characters?.some((entry) => entry.referenceAssets?.includes('gobananas://character/555')));
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
      await rm(root, { recursive: true, force: true });
    }
  });
});
