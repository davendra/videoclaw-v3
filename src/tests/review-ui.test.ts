import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addCharacterProfile } from '../video/characters.js';
import {
  buildReviewInventory,
  isReviewReportPublishReady,
  launchReviewUi,
  nextActionFromReviewReport,
  recordReviewCharacterIterationRequest,
  recordReviewStoryboardStillGenerationRequest,
  recordReviewStoryboardStillCandidate,
  recordReviewUpscaledStillCandidate,
  runReviewAutopilot,
  saveReviewDecision,
} from '../video/review-ui.js';
import { readStageCheckpoint } from '../video/checkpoints.js';
import { readSceneCandidatesArtifact, writeSceneCandidatesArtifact } from '../video/scene-candidate-store.js';
import { readProjectEvents } from '../video/events.js';
import { getBuiltinPipelineManifest } from '../video/pipeline-manifest.js';
import {
  ensureProjectWorkspace,
  readProjectManifest,
  writeProjectManifest,
} from '../video/workspace.js';

describe('review UI inventory', () => {
  it('builds project-aware inventory for the human review station', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      await mkdir(join(root, 'projects', '--project'), { recursive: true });
      await addCharacterProfile(workspace, {
        name: 'Nova',
        goBananasId: 170,
        description: 'A determined spaceship captain.',
        referenceAssets: ['refs/nova-sheet.png'],
      });
      await writeSceneCandidatesArtifact(root, 'alpha', {
        schemaVersion: 1,
        scenes: [
          {
            sceneIndex: 0,
            candidates: [
              {
                id: 'scene-0-a',
                generationRound: 1,
                prompt: 'Nova opens the story.',
                route: 'seedance',
                submittedAt: '2026-05-06T09:00:00.000Z',
                status: 'completed',
                outputs: [{ kind: 'video', path: 'projects/alpha/output/scene-0-a.mp4' }],
                source: {
                  executionRound: 1,
                  adapter: 'native',
                  chainedFromCandidateId: null,
                },
              },
            ],
          },
        ],
      });
      await writeFile(join(workspace.artifactsDir, 'brief.json'), `${JSON.stringify({
        title: 'Alpha Proof',
        intent: 'Show the product story without opening JSON.',
      })}\n`);
      await writeFile(join(workspace.artifactsDir, 'storyboard.json'), `${JSON.stringify({
        projectSlug: 'alpha',
        scenes: [
          {
            sceneIndex: 0,
            description: 'Nova opens the story.',
            characters: ['Nova'],
          },
        ],
      })}\n`);
      await writeFile(join(workspace.artifactsDir, 'asset-manifest.json'), `${JSON.stringify({
        projectSlug: 'alpha',
        assets: [
          {
            id: 'scene-0-video',
            kind: 'video',
            path: 'projects/alpha/output/scene-0-a.mp4',
            sceneIndex: 0,
          },
        ],
      })}\n`);
      await writeFile(join(workspace.artifactsDir, 'publish-report.json'), `${JSON.stringify({
        projectSlug: 'alpha',
        status: 'ready',
        finalOutputPath: 'projects/alpha/output/final.mp4',
      })}\n`);

      const inventory = await buildReviewInventory(root, 'alpha');

      assert.equal(inventory.projectSlug, 'alpha');
      assert.equal(inventory.projectExists, true);
      assert.deepEqual(inventory.projects, ['alpha']);
      assert.equal(inventory.characters[0]?.name, 'Nova');
      assert.equal(inventory.sceneCandidates.scenes[0]?.candidates[0]?.id, 'scene-0-a');
      assert.equal(inventory.brief?.title, 'Alpha Proof');
      assert.equal((inventory.storyboard?.scenes as Array<{ description?: string }> | undefined)?.[0]?.description, 'Nova opens the story.');
      assert.equal((inventory.assetManifest?.assets as Array<{ path?: string }> | undefined)?.[0]?.path, 'projects/alpha/output/scene-0-a.mp4');
      assert.equal(inventory.publishReport?.finalOutputPath, 'projects/alpha/output/final.mp4');
      assert.ok(inventory.promptReferences.some((reference) => reference.name === 'seedance-ugc-formulas'));
      assert.ok(inventory.storyboardTemplates.some((template) => template.id === 'product-commercial-4'));
      assert.ok(inventory.schemas.includes('scene-candidates'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('returns review UI launch metadata without starting a server in dry run mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-'));
    try {
      const launch = await launchReviewUi({
        root,
        projectSlug: 'alpha',
        port: 4321,
        dryRun: true,
      });

      assert.equal(launch.host, '127.0.0.1');
      assert.equal(launch.port, 4321);
      assert.equal(launch.projectSlug, 'alpha');
      assert.match(launch.url, /^http:\/\/127\.0\.0\.1:4321\/review-ui\?project=alpha$/);
      assert.equal(launch.dryRun, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records storyboard still candidates from the review UI API payload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-'));
    try {
      const result = await recordReviewStoryboardStillCandidate(root, 'alpha', {
        sceneIndex: 0,
        imageUrl: 'https://cdn.vclaw.local/review-still.jpg',
        imageId: '771',
        prompt: 'Create a clean storyboard still.',
      });

      assert.equal(result.candidate.id, 'scene-0-take-1');
      assert.equal(result.candidate.outputs[0]?.path, 'https://cdn.vclaw.local/review-still.jpg');
      assert.equal(result.candidate.source.externalJobId, '771');
      assert.equal(result.reused, false);

      const reused = await recordReviewStoryboardStillCandidate(root, 'alpha', {
        sceneIndex: 0,
        imageUrl: 'https://cdn.vclaw.local/review-still.jpg',
        imageId: '771',
        prompt: 'Duplicate paste should reuse the first candidate.',
      });
      assert.equal(reused.candidate.id, 'scene-0-take-1');
      assert.equal(reused.reused, true);

      const candidates = await readSceneCandidatesArtifact(root, 'alpha');
      assert.equal(candidates.scenes[0]?.candidates[0]?.id, 'scene-0-take-1');
      assert.equal(candidates.scenes[0]?.candidates.length, 1);

      const workspace = await ensureProjectWorkspace('alpha', root);
      const events = await readProjectEvents(workspace);
      assert.ok(events.some((event) => (
        event.type === 'storyboard-still.candidate.added'
        && event.payload?.source === 'review-ui'
      )));
      assert.ok(events.some((event) => (
        event.type === 'storyboard-still.candidate.reused'
        && event.payload?.candidateId === 'scene-0-take-1'
      )));

      const next = await recordReviewStoryboardStillCandidate(root, 'alpha', {
        sceneIndex: 0,
        imageUrl: 'https://cdn.vclaw.local/alternate-still.jpg',
        prompt: 'A second unique still.',
      });
      assert.equal(next.candidate.id, 'scene-0-take-2');

      const reusedLatest = await recordReviewStoryboardStillCandidate(root, 'alpha', {
        sceneIndex: 0,
        imageUrl: 'https://cdn.vclaw.local/alternate-still.jpg',
      });
      assert.equal(reusedLatest.candidate.id, 'scene-0-take-2');
      assert.equal(reusedLatest.reused, true);

      await assert.rejects(
        () => recordReviewStoryboardStillCandidate(root, 'alpha', {
          sceneIndex: 0,
          imageUrl: 'https://example.com/placeholder.jpg',
        }),
        /placeholder domain/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('queues Go Bananas storyboard still generation requests from the review UI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-request-'));
    try {
      const result = await recordReviewStoryboardStillGenerationRequest(root, 'alpha', {
        sceneIndex: 1,
        prompt: 'Create scene 01 storyboard still with locked character identity.',
        negativePrompt: 'readable text, logos, clutter',
        aspectRatio: '16:9',
        notes: 'Queued during storyboard review.',
      });

      assert.equal(result.request.id, 'gobananas-still-01-001');
      assert.equal(result.request.sceneIndex, 1);
      assert.equal(result.request.provider, 'gobananas');
      assert.equal(result.request.route, 'gobananas-storyboard-still');
      assert.equal(result.queue.requests.length, 1);

      const saved = JSON.parse(await readFile(result.path, 'utf-8')) as {
        requests?: Array<{ id?: string; prompt?: string; negativePrompt?: string }>;
      };
      assert.equal(saved.requests?.[0]?.id, 'gobananas-still-01-001');
      assert.match(saved.requests?.[0]?.prompt ?? '', /scene 01 storyboard still/);
      assert.equal(saved.requests?.[0]?.negativePrompt, 'readable text, logos, clutter');

      const inventory = await buildReviewInventory(root, 'alpha');
      assert.equal(inventory.generationQueue?.requests[0]?.id, 'gobananas-still-01-001');

      const candidate = await recordReviewStoryboardStillCandidate(root, 'alpha', {
        sceneIndex: 1,
        imageUrl: 'https://cdn.vclaw.local/generated-scene-1.jpg',
        imageId: '884',
        prompt: 'Generated from queued request.',
      });
      assert.equal(candidate.candidate.id, 'scene-1-take-1');
      const fulfilled = await buildReviewInventory(root, 'alpha');
      assert.equal(fulfilled.generationQueue?.requests[0]?.status, 'fulfilled');
      assert.equal(fulfilled.generationQueue?.requests[0]?.candidateId, 'scene-1-take-1');
      assert.equal(fulfilled.generationQueue?.requests[0]?.imageId, '884');

      const workspace = await ensureProjectWorkspace('alpha', root);
      const events = await readProjectEvents(workspace);
      assert.ok(events.some((event) => (
        event.type === 'storyboard-still.generation-request.queued'
        && event.payload?.requestId === 'gobananas-still-01-001'
      )));

      await assert.rejects(
        () => recordReviewStoryboardStillGenerationRequest(root, 'alpha', {
          sceneIndex: 0,
          prompt: '',
        }),
        /requires sceneIndex and prompt/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('queues Go Bananas character iteration requests from the review UI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-character-request-'));
    try {
      const result = await recordReviewCharacterIterationRequest(root, 'alpha', {
        characterName: 'Komo',
        prompt: 'Create four consistent mascot character designs on warm cream paper.',
        negativePrompt: 'photorealism, readable text, logos',
        count: 4,
        aspectRatio: '1:1',
        notes: 'Queued during character review.',
      });

      assert.equal(result.request.id, 'gobananas-character-001');
      assert.equal(result.request.route, 'gobananas-character-iteration');
      assert.equal(result.request.characterName, 'Komo');
      assert.equal(result.request.aspectRatio, 'square');
      assert.equal(result.request.count, 4);
      assert.equal(result.queue.requests.length, 1);

      const saved = JSON.parse(await readFile(result.path, 'utf-8')) as {
        requests?: Array<{ id?: string; prompt?: string; negativePrompt?: string }>;
      };
      assert.equal(saved.requests?.[0]?.id, 'gobananas-character-001');
      assert.match(saved.requests?.[0]?.prompt ?? '', /mascot character designs/);

      const inventory = await buildReviewInventory(root, 'alpha');
      assert.equal(inventory.characterQueue?.requests[0]?.id, 'gobananas-character-001');

      const workspace = await ensureProjectWorkspace('alpha', root);
      const events = await readProjectEvents(workspace);
      assert.ok(events.some((event) => (
        event.type === 'character-iteration.request.queued'
        && event.payload?.requestId === 'gobananas-character-001'
      )));

      await assert.rejects(
        () => recordReviewCharacterIterationRequest(root, 'alpha', {
          characterName: 'Komo',
          prompt: '',
        }),
        /requires prompt/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('saves the human review decision as a project artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-'));
    try {
      const workspace = await ensureProjectWorkspace('alpha', root);
      await writeProjectManifest(workspace, {
        slug: 'alpha',
        productionMode: 'director',
        createdAt: '2026-05-06T08:00:00.000Z',
        updatedAt: '2026-05-06T08:00:00.000Z',
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'review',
        lastCompletedStage: 'assets',
        lastCheckpointStatus: 'completed',
      });
      await writeSceneCandidatesArtifact(root, 'alpha', {
        schemaVersion: 1,
        scenes: [
          {
            sceneIndex: 0,
            candidates: [
              {
                id: 'scene-0-take-1',
                generationRound: 1,
                prompt: 'Opening still.',
                route: 'gobananas-storyboard-still',
                submittedAt: '2026-05-06T09:00:00.000Z',
                status: 'completed',
                outputs: [{ kind: 'image', path: 'https://example.com/scene-0.jpg' }],
                source: {
                  executionRound: 0,
                  adapter: 'custom',
                  chainedFromCandidateId: null,
                },
              },
              {
                id: 'scene-0-take-2',
                generationRound: 2,
                prompt: 'Opening still with broken placeholder output.',
                route: 'gobananas-storyboard-still',
                submittedAt: '2026-05-06T09:01:00.000Z',
                status: 'completed',
                outputs: [{ kind: 'image', path: 'https://example.com/scene-0-placeholder.jpg' }],
                source: {
                  executionRound: 0,
                  adapter: 'custom',
                  chainedFromCandidateId: null,
                },
              },
            ],
          },
          {
            sceneIndex: 1,
            candidates: [
              {
                id: 'scene-1-take-1',
                generationRound: 1,
                prompt: 'Reveal still.',
                route: 'gobananas-storyboard-still',
                submittedAt: '2026-05-06T09:02:00.000Z',
                status: 'completed',
                outputs: [{ kind: 'image', path: 'https://example.com/scene-1.jpg' }],
                source: {
                  executionRound: 0,
                  adapter: 'custom',
                  chainedFromCandidateId: 'scene-0-take-1',
                },
              },
            ],
          },
        ],
      });

      const result = await saveReviewDecision(root, 'alpha', {
        activeGate: 'assembly',
        seedanceWorkflow: {
          source: 'docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md',
          qualityBar: 'award-winning director cinematic video with minimal operator work',
          promptPatterns: {
            motionControl: 'Use image 1 as start and image 2 as end.',
          },
          bridgeTriggers: ['catch', 'logo morph'],
          negativeGuidance: ['no distorted anatomy'],
        },
        qualityScore: '8/8',
        selections: {
          assemblyPlan: 'balanced',
          'assemblyCheck-voiceover-fit': 'voiceover-fit-approved',
          'assemblyCheck-continuity-cuts': 'continuity-cuts-approved',
          'assemblyCheck-retiming-polish': 'retiming-polish-approved',
          'assemblyCheck-logo-payoff': 'logo-payoff-approved',
          'assemblyCheck-review-report': 'review-report-approved',
          'referenceRole-identity': 'character-source',
          'referenceRole-lookdev': 'seedance-ugc-formulas',
          'lockedStill-0': 'scene-0-take-1',
          'upscaledStill-0': 'scene-0-take-1-4k',
          rejectedStillCandidates: ['scene-0-take-2'],
          'continuity-1': 'extract-end-frame',
          'lockedStill-1': 'scene-1-take-1',
          'lockedStill-2': 'scene-02-director-lock',
          'lockedStill-3': 'scene-3-take-1',
          reviewCompleteAt: '2026-05-06T09:30:00.000Z',
        },
        notes: {
          voiceover: 'Match voiceover timing.',
          storyboard: 'Lock stills first.',
        },
      });

      assert.equal(result.projectSlug, 'alpha');
      assert.match(result.path, /review-ui-ledger\.json$/);
      assert.deepEqual(
        result.derivedArtifacts.map((artifact) => artifact.name),
        [
          'reference-board.json',
          'director-seedance-plan.json',
          'storyboard-stills-plan.json',
          'scene-selection.json',
          'gobananas-character-brief.json',
          'post-plan.json',
          'review-report.json',
        ],
      );
      assert.equal(result.lifecycle?.status, 'retry-required');
      assert.equal(result.lifecycle?.currentStage, 'review');
      assert.equal(result.lifecycle?.lastCompletedStage, 'assets');
      assert.equal(result.lifecycle?.manifestUpdated, true);
      const saved = JSON.parse(await readFile(result.path, 'utf-8')) as {
        decision?: {
          recommendedNextAction?: string;
          selections?: { assemblyPlan?: string };
          savedArtifact?: {
            derivedArtifacts?: Array<{ name?: string }>;
            lifecycle?: { status?: string };
          };
        };
      };
      assert.equal(saved.decision?.selections?.assemblyPlan, 'balanced');
      assert.deepEqual(
        saved.decision?.savedArtifact?.derivedArtifacts?.map((artifact) => artifact.name),
        result.derivedArtifacts.map((artifact) => artifact.name),
      );
      assert.equal(saved.decision?.savedArtifact?.lifecycle?.status, 'retry-required');
      assert.notEqual(saved.decision?.recommendedNextAction, 'Ready for publish handoff.');

      const seedancePlan = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'director-seedance-plan.json'), 'utf-8'),
      ) as {
        workflowSource?: string;
        qualityScore?: string;
        motion?: {
          promptPatterns?: { motionControl?: string };
          bridgeTriggers?: string[];
          continuityFrames?: Array<{ sceneIndex?: number; startFrame?: string | null; endFrame?: string | null }>;
        };
      };
      assert.equal(seedancePlan.workflowSource, 'docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md');
      assert.equal(seedancePlan.qualityScore, '8/8');
      assert.equal(seedancePlan.motion?.promptPatterns?.motionControl, 'Use image 1 as start and image 2 as end.');
      assert.deepEqual(seedancePlan.motion?.bridgeTriggers, ['catch', 'logo morph']);
      assert.equal(seedancePlan.motion?.continuityFrames?.[0]?.startFrame, 'scene-0-take-1');
      assert.equal(seedancePlan.motion?.continuityFrames?.[1]?.startFrame, 'scene-0-take-1');
      assert.equal(seedancePlan.motion?.continuityFrames?.[1]?.endFrame, 'scene-1-take-1');

      const referenceBoard = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'reference-board.json'), 'utf-8'),
      ) as { roleAssignments?: Array<{ role?: string; selected?: string }> };
      assert.ok(referenceBoard.roleAssignments?.some((entry) => (
        entry.role === 'identity' && entry.selected === 'character-source'
      )));

      const stillsPlan = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'storyboard-stills-plan.json'), 'utf-8'),
      ) as {
        workflowSource?: string;
        template?: { id?: string };
        scenes?: Array<{
          sceneIndex?: number;
          createPrompt?: string;
          editPrompt?: string;
          goBananas?: { tool?: string; aspectRatio?: string; scenePrompt?: string };
          upscaleTarget?: string;
          continuityRole?: string;
          lockedStillReference?: string | null;
          upscaledStillReference?: string | null;
          upscaleState?: string;
        }>;
      };
      assert.equal(stillsPlan.workflowSource, 'docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md');
      assert.equal(stillsPlan.template?.id, 'product-commercial-4');
      assert.equal(stillsPlan.scenes?.length, 4);
      assert.match(stillsPlan.scenes?.[0]?.createPrompt ?? '', /Use reference roles as source truth/);
      assert.match(stillsPlan.scenes?.[0]?.editPrompt ?? '', /Lock stills first/);
      assert.equal(stillsPlan.scenes?.[0]?.goBananas?.tool, 'generate_with_character');
      assert.equal(stillsPlan.scenes?.[0]?.goBananas?.aspectRatio, '16:9');
      assert.match(stillsPlan.scenes?.[0]?.goBananas?.scenePrompt ?? '', /Problem hook/);
      assert.equal(stillsPlan.scenes?.[0]?.upscaleTarget, '4k-before-seedance');
      assert.equal(stillsPlan.scenes?.[0]?.lockedStillReference, 'scene-0-take-1');
      assert.equal(stillsPlan.scenes?.[0]?.upscaledStillReference, 'scene-0-take-1-4k');
      assert.equal(stillsPlan.scenes?.[0]?.upscaleState, 'operator-marked-upscaled');
      assert.equal(stillsPlan.scenes?.[1]?.upscaleState, 'needs-upscale-confirmation');
      assert.equal(stillsPlan.scenes?.[1]?.continuityRole, 'target-end-frame-for-previous-scene');

      const sceneSelection = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'scene-selection.json'), 'utf-8'),
      ) as {
        scenes?: Array<{
          sceneIndex?: number;
          selectedCandidateId?: string | null;
          rejectedCandidateIds?: string[];
          chainFromPrev?: boolean;
          notes?: string;
        }>;
      };
      assert.equal(sceneSelection.scenes?.[0]?.sceneIndex, 0);
      assert.equal(sceneSelection.scenes?.[0]?.selectedCandidateId, 'scene-0-take-1');
      assert.deepEqual(sceneSelection.scenes?.[0]?.rejectedCandidateIds, ['scene-0-take-2']);
      assert.equal(sceneSelection.scenes?.[0]?.chainFromPrev, false);
      assert.equal(sceneSelection.scenes?.[1]?.selectedCandidateId, 'scene-1-take-1');
      assert.equal(sceneSelection.scenes?.[1]?.chainFromPrev, false);
      assert.equal(sceneSelection.scenes?.length, 2);
      assert.match(sceneSelection.scenes?.[0]?.notes ?? '', /review-ui locked storyboard still/);

      const characterBrief = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'gobananas-character-brief.json'), 'utf-8'),
      ) as { iterationCount?: number; requiredOutputs?: string[]; saveBackToVideoClaw?: { command?: string } };
      assert.equal(characterBrief.iterationCount, 4);
      assert.ok(characterBrief.requiredOutputs?.includes('full-body canonical identity reference'));
      assert.match(characterBrief.saveBackToVideoClaw?.command ?? '', /vclaw video character-add --project alpha/);

      const postPlan = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'post-plan.json'), 'utf-8'),
      ) as {
        assemblyPlan?: string;
        voiceoverTiming?: string;
        publishReady?: boolean;
        assemblyApprovals?: Array<{ id?: string; approved?: boolean }>;
      };
      assert.equal(postPlan.assemblyPlan, 'balanced');
      assert.equal(postPlan.voiceoverTiming, 'Match voiceover timing.');
      assert.equal(postPlan.publishReady, false);
      assert.equal(postPlan.assemblyApprovals?.length, 5);

      const reviewReport = JSON.parse(
        await readFile(join(root, 'projects', 'alpha', 'artifacts', 'review-report.json'), 'utf-8'),
      ) as {
        verdict?: string;
        metrics?: {
          lockedSceneCount?: number;
          publishReady?: boolean;
          publishApprovalCount?: number;
        };
      };
      assert.equal(reviewReport.verdict, 'retry');
      assert.equal(reviewReport.metrics?.lockedSceneCount, 2);
      assert.equal(reviewReport.metrics?.publishReady, false);
      assert.equal(reviewReport.metrics?.publishApprovalCount, 5);

      const checkpoint = await readStageCheckpoint(workspace, 'review');
      assert.equal(checkpoint?.status, 'retry-required');
      assert.equal(checkpoint?.artifacts['review-report'], join(root, 'projects', 'alpha', 'artifacts', 'review-report.json'));
      assert.match(checkpoint?.nextAction ?? '', /Resolve review quality checks|Attach artifact-backed|Lock generated storyboard/);

      const updatedManifest = await readProjectManifest(workspace);
      assert.equal(updatedManifest?.currentStage, 'review');
      assert.equal(updatedManifest?.lastCompletedStage, 'assets');
      assert.equal(updatedManifest?.lastCheckpointStatus, 'retry-required');

      const inventory = await buildReviewInventory(root, 'alpha');
      assert.equal(inventory.projectExists, true);
      assert.equal(inventory.reviewLedger?.projectSlug, 'alpha');
      assert.equal(inventory.reviewReport?.projectSlug, 'alpha');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('normalizes completed review UI handoff artifacts to publish next action', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-complete-'));
    try {
      const workspace = await ensureProjectWorkspace('ready', root);
      await writeProjectManifest(workspace, {
        slug: 'ready',
        productionMode: 'director',
        createdAt: '2026-05-06T08:00:00.000Z',
        updatedAt: '2026-05-06T08:00:00.000Z',
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'review',
        lastCompletedStage: 'assets',
        lastCheckpointStatus: 'completed',
      });
      await writeSceneCandidatesArtifact(root, 'ready', {
        schemaVersion: 1,
        scenes: Array.from({ length: 4 }, (_, sceneIndex) => ({
          sceneIndex,
          candidates: [
            {
              id: `scene-${sceneIndex}-take-1`,
              generationRound: 1,
              prompt: `Scene ${sceneIndex} locked still.`,
              route: 'gobananas-storyboard-still',
              submittedAt: '2026-05-06T09:00:00.000Z',
              status: 'completed',
              outputs: [{ kind: 'image', path: `https://cdn.vclaw.local/scene-${sceneIndex}.jpg` }],
              source: {
                executionRound: 0,
                adapter: 'custom',
                chainedFromCandidateId: sceneIndex > 0 ? `scene-${sceneIndex - 1}-take-1` : null,
              },
            },
            {
              id: `scene-${sceneIndex}-take-1-4k`,
              generationRound: 2,
              prompt: `Scene ${sceneIndex} upscaled still.`,
              route: 'upscaled-storyboard-still',
              submittedAt: '2026-05-06T09:05:00.000Z',
              status: 'completed',
              outputs: [{ kind: 'image', path: `projects/ready/assets/upscaled/storyboard/scene-${sceneIndex}-4k.jpg` }],
              source: {
                executionRound: 0,
                adapter: 'custom',
                chainedFromCandidateId: `scene-${sceneIndex}-take-1`,
              },
            },
          ],
        })),
      });

      const selections: Record<string, unknown> = {
        characterPlan: 'generate-gobananas-iterations',
        reference: 'seedance-ugc-formulas',
        'referenceRole-identity': 'generate-gobananas-iterations',
        template: 'product-commercial-4',
        bridgePosePlan: 'bridge-hard-actions',
        motionCandidate: 'control-pass',
        assemblyPlan: 'balanced',
        reviewCompleteAt: '2026-05-06T10:00:00.000Z',
      };
      for (let index = 0; index < 4; index += 1) {
        selections[`draftStill-${index}`] = `scene-${index}-take-1`;
        selections[`editStill-${index}`] = `scene-${index}-take-1-edit-needed`;
        selections[`lockedStill-${index}`] = `scene-${index}-take-1`;
        selections[`upscaledStill-${index}`] = `scene-${index}-take-1-4k`;
        selections[`continuity-${index}`] = index === 0 ? 'start-frame-confirmed' : 'extract-end-frame';
      }
      for (const id of ['voiceover-fit', 'continuity-cuts', 'retiming-polish', 'logo-payoff', 'review-report']) {
        selections[`assemblyCheck-${id}`] = `${id}-approved`;
      }

      const result = await saveReviewDecision(root, 'ready', {
        activeGate: 'assembly',
        seedanceWorkflow: {
          source: 'docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md',
          qualityBar: 'award-winning director cinematic video with minimal operator work',
        },
        qualityScore: '8/8',
        recommendedNextAction: 'Ready to write review artifacts.',
        selections,
        notes: {},
      });

      assert.equal(result.lifecycle?.status, 'completed');
      assert.equal(result.reviewReport?.verdict, 'pass');
      const saved = JSON.parse(await readFile(result.path, 'utf-8')) as {
        decision?: {
          recommendedNextAction?: string;
          savedArtifact?: { lifecycle?: { status?: string } };
        };
      };
      assert.equal(saved.decision?.recommendedNextAction, 'Ready for publish handoff.');
      assert.equal(saved.decision?.savedArtifact?.lifecycle?.status, 'completed');

      const reviewReport = JSON.parse(
        await readFile(join(root, 'projects', 'ready', 'artifacts', 'review-report.json'), 'utf-8'),
      ) as { verdict?: string; metrics?: { nextAction?: string } };
      assert.equal(reviewReport.verdict, 'pass');
      assert.equal(reviewReport.metrics?.nextAction, 'Ready for publish handoff.');

      const directorPlan = JSON.parse(
        await readFile(join(root, 'projects', 'ready', 'artifacts', 'director-seedance-plan.json'), 'utf-8'),
      ) as { nextAction?: string };
      assert.equal(directorPlan.nextAction, 'Ready for publish handoff.');

      const assetManifest = JSON.parse(
        await readFile(join(root, 'projects', 'ready', 'artifacts', 'asset-manifest.json'), 'utf-8'),
      ) as {
        assets?: Array<{ id?: string; path?: string; sceneIndex?: number; backend?: string }>;
      };
      assert.equal(assetManifest.assets?.length, 4);
      assert.deepEqual(
        assetManifest.assets?.map((asset) => asset.path),
        [
          'assets/upscaled/storyboard/scene-0-4k.jpg',
          'assets/upscaled/storyboard/scene-1-4k.jpg',
          'assets/upscaled/storyboard/scene-2-4k.jpg',
          'assets/upscaled/storyboard/scene-3-4k.jpg',
        ],
      );
      assert.deepEqual(
        assetManifest.assets?.map((asset) => asset.backend),
        Array.from({ length: 4 }, () => 'upscaled-storyboard-still'),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('excludes locked storyboard stills that do not match the selected character', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-character-lock-'));
    try {
      await ensureProjectWorkspace('proofy-lock', root);
      await writeSceneCandidatesArtifact(root, 'proofy-lock', {
        schemaVersion: 1,
        scenes: [
          {
            sceneIndex: 0,
            candidates: [
              {
                id: 'scene-0-take-1',
                generationRound: 1,
                prompt: 'Komo opens the story beside a product panel.',
                route: 'gobananas-storyboard-still',
                submittedAt: '2026-05-06T09:00:00.000Z',
                status: 'completed',
                outputs: [{ kind: 'image', path: 'https://cdn.vclaw.local/komo-scene-0.jpg' }],
                source: {
                  executionRound: 1,
                  adapter: 'custom',
                  externalJobId: 'komo-1',
                  chainedFromCandidateId: null,
                },
              },
              {
                id: 'scene-0-take-2',
                generationRound: 2,
                prompt: 'Proofy opens the story beside a product panel.',
                route: 'gobananas-storyboard-still',
                submittedAt: '2026-05-06T09:05:00.000Z',
                status: 'completed',
                outputs: [{ kind: 'image', path: 'https://cdn.vclaw.local/proofy-scene-0.jpg' }],
                source: {
                  executionRound: 1,
                  adapter: 'custom',
                  externalJobId: 'proofy-1',
                  chainedFromCandidateId: null,
                },
              },
            ],
          },
        ],
      });

      const result = await saveReviewDecision(root, 'proofy-lock', {
        activeGate: 'assembly',
        qualityScore: '8/8',
        recommendedNextAction: 'Ready to write review artifacts.',
        selections: {
          character: 'proofy',
          'referenceRole-identity': 'proofy',
          template: 'beat-structure-3',
          'lockedStill-0': 'scene-0-take-1',
          'upscaledStill-0': 'scene-0-take-1-4k',
          reviewCompleteAt: '2026-05-06T10:00:00.000Z',
          'assemblyCheck-voiceover-fit': 'voiceover-fit-approved',
          'assemblyCheck-continuity-cuts': 'continuity-cuts-approved',
          'assemblyCheck-retiming-polish': 'retiming-polish-approved',
          'assemblyCheck-logo-payoff': 'logo-payoff-approved',
          'assemblyCheck-review-report': 'review-report-approved',
        },
        notes: {},
      });

      const sceneSelection = JSON.parse(
        await readFile(join(root, 'projects', 'proofy-lock', 'artifacts', 'scene-selection.json'), 'utf-8'),
      ) as { scenes?: Array<{ selectedCandidateId?: string | null; pendingCandidateIds?: string[]; notes?: string }> };
      assert.equal(sceneSelection.scenes?.[0]?.selectedCandidateId, null);
      assert.deepEqual(sceneSelection.scenes?.[0]?.pendingCandidateIds, ['scene-0-take-2']);
      assert.match(sceneSelection.scenes?.[0]?.notes ?? '', /must match character "proofy"/);

      const reviewReport = JSON.parse(
        await readFile(join(root, 'projects', 'proofy-lock', 'artifacts', 'review-report.json'), 'utf-8'),
      ) as { verdict?: string; findings?: string[]; metrics?: { characterMismatchCount?: number } };
      assert.equal(reviewReport.verdict, 'retry');
      assert.equal(reviewReport.metrics?.characterMismatchCount, 1);
      assert.ok(reviewReport.findings?.some((finding) => finding.includes('scene-0-take-1')));
      assert.equal(result.lifecycle?.status, 'retry-required');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('records artifact-backed upscaled still candidates for locked storyboard stills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-upscale-'));
    try {
      await ensureProjectWorkspace('upscale-proof', root);
      await writeSceneCandidatesArtifact(root, 'upscale-proof', {
        schemaVersion: 1,
        scenes: [
          {
            sceneIndex: 0,
            candidates: [
              {
                id: 'scene-0-take-1',
                generationRound: 1,
                prompt: 'Proofy locked storyboard still.',
                route: 'gobananas-storyboard-still',
                submittedAt: '2026-05-06T09:00:00.000Z',
                status: 'completed',
                outputs: [{ kind: 'image', path: 'https://cdn.vclaw.local/proofy-scene-0.jpg' }],
                source: {
                  executionRound: 1,
                  adapter: 'custom',
                  externalJobId: 'proofy-1',
                  chainedFromCandidateId: null,
                },
              },
            ],
          },
        ],
      });

      const recorded = await recordReviewUpscaledStillCandidate(root, 'upscale-proof', {
        sceneIndex: 0,
        sourceCandidateId: 'scene-0-take-1',
        imageUrl: 'projects/upscale-proof/assets/upscaled/storyboard/proofy-scene-0-4k.jpg',
        imageId: 'proofy-1-4k',
      });
      assert.equal(recorded.candidate.id, 'scene-0-take-1-4k');
      assert.equal(recorded.candidate.route, 'upscaled-storyboard-still');
      assert.equal(recorded.candidate.source.chainedFromCandidateId, 'scene-0-take-1');

      const result = await saveReviewDecision(root, 'upscale-proof', {
        activeGate: 'assembly',
        qualityScore: '8/8',
        recommendedNextAction: 'Ready to write review artifacts.',
        selections: {
          character: 'proofy',
          template: 'beat-structure-3',
          'lockedStill-0': 'scene-0-take-1',
          'upscaledStill-0': 'scene-0-take-1-4k',
          reviewCompleteAt: '2026-05-06T10:00:00.000Z',
          'assemblyCheck-voiceover-fit': 'voiceover-fit-approved',
          'assemblyCheck-continuity-cuts': 'continuity-cuts-approved',
          'assemblyCheck-retiming-polish': 'retiming-polish-approved',
          'assemblyCheck-logo-payoff': 'logo-payoff-approved',
          'assemblyCheck-review-report': 'review-report-approved',
        },
        notes: {},
      });

      const stillsPlan = JSON.parse(
        await readFile(join(root, 'projects', 'upscale-proof', 'artifacts', 'storyboard-stills-plan.json'), 'utf-8'),
      ) as { scenes?: Array<{ upscaleEvidenceState?: string }> };
      assert.equal(stillsPlan.scenes?.[0]?.upscaleEvidenceState, 'artifact-backed-upscale');

      const sceneSelection = JSON.parse(
        await readFile(join(root, 'projects', 'upscale-proof', 'artifacts', 'scene-selection.json'), 'utf-8'),
      ) as { scenes?: Array<{ pendingCandidateIds?: string[] }> };
      assert.deepEqual(sceneSelection.scenes?.[0]?.pendingCandidateIds, []);

      const reviewReport = JSON.parse(
        await readFile(join(root, 'projects', 'upscale-proof', 'artifacts', 'review-report.json'), 'utf-8'),
      ) as { metrics?: { artifactBackedUpscaleCount?: number; operatorOnlyUpscaleCount?: number } };
      assert.equal(reviewReport.metrics?.artifactBackedUpscaleCount, 1);
      assert.equal(reviewReport.metrics?.operatorOnlyUpscaleCount, 0);
      assert.equal(result.lifecycle?.status, 'retry-required');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps old wrong-character rejected stills out of the current handoff bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-rejection-scrub-'));
    try {
      await ensureProjectWorkspace('proofy-clean', root);
      await writeSceneCandidatesArtifact(root, 'proofy-clean', {
        schemaVersion: 1,
        scenes: [
          {
            sceneIndex: 0,
            candidates: [
              {
                id: 'scene-0-take-1',
                generationRound: 1,
                prompt: 'Komo stands beside the app screen.',
                route: 'gobananas-storyboard-still',
                submittedAt: '2026-05-06T09:00:00.000Z',
                status: 'completed',
                outputs: [{ kind: 'image', path: 'https://cdn.vclaw.local/komo-scene-0.jpg' }],
                source: {
                  executionRound: 1,
                  adapter: 'custom',
                  externalJobId: 'komo-1',
                  chainedFromCandidateId: null,
                },
              },
              {
                id: 'scene-0-take-2',
                generationRound: 2,
                prompt: 'Proofy stands beside the app screen.',
                route: 'gobananas-storyboard-still',
                submittedAt: '2026-05-06T09:05:00.000Z',
                status: 'completed',
                outputs: [{ kind: 'image', path: 'https://cdn.vclaw.local/proofy-scene-0.jpg' }],
                source: {
                  executionRound: 1,
                  adapter: 'custom',
                  externalJobId: 'proofy-1',
                  chainedFromCandidateId: null,
                },
              },
              {
                id: 'scene-0-take-2-4k',
                generationRound: 3,
                prompt: 'Proofy upscaled still.',
                route: 'upscaled-storyboard-still',
                submittedAt: '2026-05-06T09:10:00.000Z',
                status: 'completed',
                outputs: [{ kind: 'image', path: 'projects/proofy-clean/assets/upscaled/storyboard/proofy-scene-0-4k.jpg' }],
                source: {
                  executionRound: 1,
                  adapter: 'custom',
                  chainedFromCandidateId: 'scene-0-take-2',
                },
              },
            ],
          },
        ],
      });

      await saveReviewDecision(root, 'proofy-clean', {
        activeGate: 'assembly',
        qualityScore: '8/8',
        recommendedNextAction: 'Ready to write review artifacts.',
        selections: {
          character: 'proofy',
          template: 'beat-structure-3',
          'lockedStill-0': 'scene-0-take-2',
          'upscaledStill-0': 'scene-0-take-2-4k',
          rejectedStillCandidates: ['scene-0-take-1'],
          reviewCompleteAt: '2026-05-06T10:00:00.000Z',
          'assemblyCheck-voiceover-fit': 'voiceover-fit-approved',
          'assemblyCheck-continuity-cuts': 'continuity-cuts-approved',
          'assemblyCheck-retiming-polish': 'retiming-polish-approved',
          'assemblyCheck-logo-payoff': 'logo-payoff-approved',
          'assemblyCheck-review-report': 'review-report-approved',
        },
        notes: {},
      });

      const sceneSelection = JSON.parse(
        await readFile(join(root, 'projects', 'proofy-clean', 'artifacts', 'scene-selection.json'), 'utf-8'),
      ) as { scenes?: Array<{ rejectedCandidateIds?: string[] }> };
      assert.deepEqual(sceneSelection.scenes?.[0]?.rejectedCandidateIds, []);

      const stillsPlan = JSON.parse(
        await readFile(join(root, 'projects', 'proofy-clean', 'artifacts', 'storyboard-stills-plan.json'), 'utf-8'),
      ) as { scenes?: Array<{ rejectedStillReferences?: string[] }> };
      assert.deepEqual(stillsPlan.scenes?.[0]?.rejectedStillReferences, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps completed review in retry when upscaled stills are marker-only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-ui-marker-only-'));
    try {
      await ensureProjectWorkspace('marker-only', root);
      await writeSceneCandidatesArtifact(root, 'marker-only', {
        schemaVersion: 1,
        scenes: [
          {
            sceneIndex: 0,
            candidates: [
              {
                id: 'scene-0-take-1',
                generationRound: 1,
                prompt: 'Proofy locked storyboard still.',
                route: 'gobananas-storyboard-still',
                submittedAt: '2026-05-06T09:00:00.000Z',
                status: 'completed',
                outputs: [{ kind: 'image', path: 'https://cdn.vclaw.local/proofy-scene-0.jpg' }],
                source: {
                  executionRound: 1,
                  adapter: 'custom',
                  chainedFromCandidateId: null,
                },
              },
            ],
          },
        ],
      });

      const result = await saveReviewDecision(root, 'marker-only', {
        activeGate: 'assembly',
        qualityScore: '8/8',
        recommendedNextAction: 'Ready to write review artifacts.',
        selections: {
          character: 'proofy',
          template: 'beat-structure-3',
          'lockedStill-0': 'scene-0-take-1',
          'upscaledStill-0': 'scene-0-take-1-4k',
          reviewCompleteAt: '2026-05-06T10:00:00.000Z',
          'assemblyCheck-voiceover-fit': 'voiceover-fit-approved',
          'assemblyCheck-continuity-cuts': 'continuity-cuts-approved',
          'assemblyCheck-retiming-polish': 'retiming-polish-approved',
          'assemblyCheck-logo-payoff': 'logo-payoff-approved',
          'assemblyCheck-review-report': 'review-report-approved',
        },
        notes: {},
      });

      const reviewReport = JSON.parse(
        await readFile(join(root, 'projects', 'marker-only', 'artifacts', 'review-report.json'), 'utf-8'),
      ) as {
        verdict?: string;
        findings?: string[];
        metrics?: { missingUpscaleAssetCount?: number; publishReady?: boolean };
      };
      assert.equal(reviewReport.verdict, 'retry');
      assert.equal(reviewReport.metrics?.missingUpscaleAssetCount, 3);
      assert.equal(reviewReport.metrics?.publishReady, false);
      assert.ok(reviewReport.findings?.some((finding) => finding.includes('4k/upscaled')));
      assert.equal(result.lifecycle?.status, 'retry-required');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('autopilot completes the review handoff from existing storyboard still candidates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-autopilot-'));
    try {
      const workspace = await ensureProjectWorkspace('auto-proof', root);
      await writeProjectManifest(workspace, {
        slug: 'auto-proof',
        productionMode: 'director',
        createdAt: '2026-05-06T08:00:00.000Z',
        updatedAt: '2026-05-06T08:00:00.000Z',
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'completed',
      });
      await addCharacterProfile(workspace, {
        name: 'Proofy',
        goBananasId: 249,
        description: 'A flat illustrated proof mascot.',
        referenceAssets: [],
        notes: [],
      });
      for (let index = 0; index < 4; index += 1) {
        const assetDir = join(workspace.projectDir, 'assets', 'storyboard');
        await mkdir(assetDir, { recursive: true });
        await writeFile(join(assetDir, `scene-${index}.jpg`), `fake-image-${index}`);
      }
      await writeSceneCandidatesArtifact(root, 'auto-proof', {
        schemaVersion: 1,
        scenes: Array.from({ length: 4 }, (_, sceneIndex) => ({
          sceneIndex,
          candidates: [
            {
              id: `scene-${sceneIndex}-take-1`,
              generationRound: 1,
              prompt: `Proofy locked storyboard still for scene ${sceneIndex}.`,
              route: 'gobananas-storyboard-still',
              submittedAt: '2026-05-06T09:00:00.000Z',
              status: 'completed',
              outputs: [{ kind: 'image', path: `assets/storyboard/scene-${sceneIndex}.jpg` }],
              source: {
                executionRound: 0,
                adapter: 'custom',
                externalJobId: `proofy-${sceneIndex}`,
                chainedFromCandidateId: null,
              },
            },
          ],
        })),
      });
      await writeFile(join(workspace.artifactsDir, 'storyboard.json'), `${JSON.stringify({
        projectSlug: 'auto-proof',
        productionMode: 'director',
        scenes: [
          {
            sceneIndex: 0,
            description: 'Mumbai night arrival: Proofy enters a neon monsoon street beside a friendly monster.',
            characters: ['Proofy', 'Neon Monster'],
            durationSeconds: 5,
            dialogue: 'Proofy: We follow the lights.',
            scenePrompt: {
              imagePrompt: 'Custom Mumbai neon still prompt.',
              cameraMove: 'static',
            },
          },
          {
            sceneIndex: 1,
            description: 'Monster reveal: Proofy and the monster hold one dance pose near a decorated tuk-tuk.',
            characters: ['Proofy', 'Neon Monster'],
          },
          {
            sceneIndex: 2,
            description: 'Journey beat: Proofy and the monster face a glowing disco entrance in India.',
            characters: ['Proofy', 'Neon Monster'],
          },
          {
            sceneIndex: 3,
            description: 'Rave payoff: Proofy and the monster land in a colourful final hero pose.',
            characters: ['Proofy', 'Neon Monster'],
          },
        ],
      }, null, 2)}\n`);

      const result = await runReviewAutopilot({
        root,
        projectSlug: 'auto-proof',
        runId: 'test-run',
      });

      assert.equal(result.character, 'proofy');
      assert.equal(result.lockedStills.length, 4);
      assert.equal(result.upscaledStills.length, 4);
      assert.equal(result.decision.lifecycle?.status, 'completed');
      assert.equal(result.reviewReport?.verdict, 'pass');
      assert.equal((result.reviewReport?.metrics as { publishReady?: boolean } | undefined)?.publishReady, true);

      const assetManifest = JSON.parse(
        await readFile(join(workspace.artifactsDir, 'asset-manifest.json'), 'utf-8'),
      ) as { assets?: Array<{ backend?: string; path?: string }> };
      assert.deepEqual(
        assetManifest.assets?.map((asset) => asset.backend),
        Array.from({ length: 4 }, () => 'upscaled-storyboard-still'),
      );
      assert.ok(assetManifest.assets?.every((asset) => asset.path?.includes('assets/upscaled/storyboard/test-run/')));

      const storyboard = JSON.parse(
        await readFile(join(workspace.artifactsDir, 'storyboard.json'), 'utf-8'),
      ) as { scenes?: Array<{ description?: string; characters?: string[]; durationSeconds?: number; dialogue?: string; scenePrompt?: { imagePrompt?: string } }> };
      assert.equal(
        storyboard.scenes?.[0]?.description,
        'Mumbai night arrival: Proofy enters a neon monsoon street beside a friendly monster.',
      );
      assert.deepEqual(storyboard.scenes?.[0]?.characters, ['Proofy', 'Neon Monster']);
      assert.equal(storyboard.scenes?.[0]?.durationSeconds, 5);
      assert.equal(storyboard.scenes?.[0]?.dialogue, 'Proofy: We follow the lights.');
      assert.equal(storyboard.scenes?.[0]?.scenePrompt?.imagePrompt, 'Custom Mumbai neon still prompt.');

      const stillsPlan = JSON.parse(
        await readFile(join(workspace.artifactsDir, 'storyboard-stills-plan.json'), 'utf-8'),
      ) as { scenes?: Array<{ beat?: string; createPrompt?: string }> };
      assert.equal(
        stillsPlan.scenes?.[0]?.beat,
        'Mumbai night arrival: Proofy enters a neon monsoon street beside a friendly monster.',
      );
      assert.match(stillsPlan.scenes?.[0]?.createPrompt ?? '', /Custom Mumbai neon still prompt/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses custom storyboard scene count for completed review truth', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vclaw-review-custom-count-'));
    try {
      const workspace = await ensureProjectWorkspace('custom-count', root);
      await writeProjectManifest(workspace, {
        slug: 'custom-count',
        productionMode: 'director',
        createdAt: '2026-05-06T08:00:00.000Z',
        updatedAt: '2026-05-06T08:00:00.000Z',
        pipeline: getBuiltinPipelineManifest('director'),
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'completed',
      });
      await writeFile(join(workspace.artifactsDir, 'storyboard.json'), `${JSON.stringify({
        projectSlug: 'custom-count',
        productionMode: 'director',
        scenes: [0, 1, 2].map((sceneIndex) => ({
          sceneIndex,
          description: `Custom three-scene storyboard beat ${sceneIndex}.`,
        })),
      }, null, 2)}\n`);
      await writeSceneCandidatesArtifact(root, 'custom-count', {
        schemaVersion: 1,
        scenes: [0, 1, 2].map((sceneIndex) => ({
          sceneIndex,
          candidates: [
            {
              id: `scene-${sceneIndex}-take-1`,
              generationRound: 1,
              prompt: `Custom locked still for scene ${sceneIndex}.`,
              route: 'gobananas-storyboard-still',
              submittedAt: '2026-05-06T09:00:00.000Z',
              status: 'completed',
              outputs: [{ kind: 'image', path: `assets/storyboard/scene-${sceneIndex}.jpg` }],
              source: {
                executionRound: 0,
                adapter: 'custom',
                externalJobId: `custom-${sceneIndex}`,
                chainedFromCandidateId: null,
              },
            },
            {
              id: `scene-${sceneIndex}-take-1-4k`,
              generationRound: 2,
              prompt: `Custom upscaled still for scene ${sceneIndex}.`,
              route: 'upscaled-storyboard-still',
              submittedAt: '2026-05-06T09:30:00.000Z',
              status: 'completed',
              outputs: [{ kind: 'image', path: `assets/upscaled/scene-${sceneIndex}.jpg` }],
              source: {
                executionRound: 0,
                adapter: 'custom',
                externalJobId: `custom-${sceneIndex}-4k`,
                chainedFromCandidateId: `scene-${sceneIndex}-take-1`,
              },
            },
          ],
        })),
      });

      const selections: Record<string, unknown> = {
        template: 'product-commercial-4',
        reviewCompleteAt: '2026-05-06T10:00:00.000Z',
      };
      for (const sceneIndex of [0, 1, 2]) {
        selections[`lockedStill-${sceneIndex}`] = `scene-${sceneIndex}-take-1`;
        selections[`upscaledStill-${sceneIndex}`] = `scene-${sceneIndex}-take-1-4k`;
      }
      for (const id of ['voiceover-fit', 'continuity-cuts', 'retiming-polish', 'logo-payoff', 'review-report']) {
        selections[`assemblyCheck-${id}`] = `${id}-approved`;
      }

      const result = await saveReviewDecision(root, 'custom-count', {
        activeGate: 'assembly',
        seedanceWorkflow: {
          source: 'docs/REFERENCE_VIDEO_SEEDANCE_MOTION_DESIGN_WORKFLOW.md',
          qualityBar: 'award-winning director cinematic video with minimal operator work',
        },
        qualityScore: '8/8',
        selections,
        notes: {},
      });

      assert.equal(result.reviewReport?.verdict, 'pass');
      const metrics = result.reviewReport?.metrics as { expectedSceneCount?: number; publishReady?: boolean } | undefined;
      assert.equal(metrics?.expectedSceneCount, 3);
      assert.equal(metrics?.publishReady, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps visible publish-ready labels tied to canonical review truth', async () => {
    const html = await readFile(
      join(process.cwd(), 'tmp', 'review-station', 'index.html'),
      'utf-8',
    );

    assert.match(html, /savedReviewPassed\(\) \? "publish ready" : "reviewing"/);
    assert.doesNotMatch(html, /publish\?\.status === "ready" \? "publish ready"/);
    assert.match(html, /apiInventory\.publishReport\?\.status === "ready" && savedReviewPassed\(\)/);
    assert.doesNotMatch(html, /Published handoff status/);
    assert.doesNotMatch(html, /state\.savedArtifact\?\.lifecycle\?\.status === "completed"\) return true/);
    assert.match(html, /report\?\.verdict === "pass" && report\?\.metrics\?\.publishReady === true/);
    assert.match(html, /return state\.savedArtifact\?\.reviewReport \|\| inventory\.reviewReport \|\| null/);
    assert.doesNotMatch(html, /inventory\.reviewReport \|\| state\.savedArtifact\?\.reviewReport/);
    assert.match(html, /function reviewComplete\(\) {\s*return savedReviewPassed\(\);\s*}/);
    assert.match(html, /reviewComplete\(\) \? "Review artifacts saved\. Ready for publish handoff\."/);
    assert.doesNotMatch(html, /function reviewComplete\(\) {\s*return missingForStage\(\)\.length === 0/);
  });

  it('keeps Review UI button clicks visibly acknowledged near the active step', async () => {
    const html = await readFile(
      join(process.cwd(), 'tmp', 'review-station', 'index.html'),
      'utf-8',
    );

    assert.match(html, /id="actionFeedback" role="status" aria-live="polite"/);
    assert.match(html, /function selectionFeedback\(key, value\)/);
    assert.match(html, /state\.statusMessage = shouldAutosaveSelection\(key\) \? "Saving storyboard selection\.\.\." : selectionFeedback\(key, value\)/);
    assert.match(html, /feedback\.textContent = feedbackText/);
    assert.match(html, /state\.statusMessage = `Moved to \$\{currentStage\(\)\.label\}\.`/);
  });

  it('serves packaged presenter asset paths from the Review UI server', async () => {
    const source = await readFile(
      join(process.cwd(), 'src', 'video', 'review-ui.ts'),
      'utf-8',
    );

    assert.match(source, /function safeStaticAssetPathFromUrl/);
    assert.match(source, /skills\/davendra-presenter\/assets\//);
    assert.match(source, /skills\/nex-presenter\/assets\//);
    assert.match(source, /docs\/assets\//);
    assert.match(source, /const projectPath = safePathFromUrl\(options\.root, requestUrl\.pathname\)/);
    assert.match(source, /const staticPath = safeStaticAssetPathFromUrl\(options\.staticRoot, requestUrl\.pathname\)/);
    assert.doesNotMatch(source, /const requestedPath = safePathFromUrl\(options\.root, requestUrl\.pathname\);\s*if \(!requestedPath\)/);
  });

  it('keeps legacy pass reports without publishReady out of publish handoff', () => {
    const legacyReport = {
      verdict: 'pass',
      findings: [],
      metrics: {
        publishReady: false,
        nextAction: 'Ready for publish handoff.',
      },
    };

    assert.equal(isReviewReportPublishReady(legacyReport), false);
    assert.equal(
      nextActionFromReviewReport(legacyReport, 'Resolve review findings before publishing.'),
      'Complete publish readiness evidence before publishing.',
    );
  });
});
