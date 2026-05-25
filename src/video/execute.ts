import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { artifactPathFor, writeArtifact } from './artifact-store.js';
import { readStageCheckpoint, writeStageCheckpoint } from './checkpoints.js';
import { autoFixDirectorStoryboardContent, runDirectorPreflight } from './director-preflight.js';
import { appendProjectEvent } from './events.js';
import { buildExecutionPlan } from './execution-plan.js';
import {
  appendGenerationTelemetry,
  buildGenerationTelemetryFromReport,
} from './generation-telemetry.js';
import {
  buildExecutionPayload,
  ChainFromPrevSourceMissingError,
  submitExecutionPayload,
} from './execution-runtime.js';
import {
  appendCandidate,
  maxRoundForScene,
  nextCandidateId,
} from './scene-candidates.js';
import {
  readSceneCandidatesArtifact,
  sceneCandidatesPathFor,
  writeSceneCandidatesArtifact,
} from './scene-candidate-store.js';
import {
  markPending,
} from './scene-selection.js';
import {
  readSceneSelectionArtifact,
  writeSceneSelectionArtifact,
} from './scene-selection-store.js';
import { buildProjectStatusReport } from './status.js';
import { isStoryboardApproved, writeStoryboardMarkdownReview } from './storyboard-markdown.js';
import { appendVideoContextChangelog } from './video-context.js';
import { updateProjectManifestState, ensureProjectWorkspace } from './workspace.js';
import type {
  SceneCandidate,
  SceneCandidatesArtifact,
  SceneSelectionArtifact,
  VideoExecutionReport,
  VideoProductionMode,
} from './types.js';

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

function buildStoryboardApprovalCommand(projectSlug: string, root: string): string {
  return [
    'VIDEOCLAW_APPROVE_STORYBOARD=1',
    'vclaw',
    'video',
    'execute',
    '--project',
    shellQuote(projectSlug),
    '--root',
    shellQuote(root),
    '--mode',
    'director',
  ].join(' ');
}

function buildStoryboardRefreshCommand(projectSlug: string, root: string): string {
  return [
    'vclaw',
    'video',
    'storyboard-review',
    '--project',
    shellQuote(projectSlug),
    '--root',
    shellQuote(root),
    '--mode',
    'director',
  ].join(' ');
}

export async function executeProject(
  projectSlug: string,
  options: {
    root?: string;
    productionMode?: VideoProductionMode;
    dryRun?: boolean;
    env?: NodeJS.ProcessEnv;
    /**
     * Restrict execution to these scene indices. When omitted, all storyboard
     * scenes are submitted (legacy behavior). Presence of this flag also
     * forces candidate-mode on for this run even if `scene-candidates.json`
     * does not yet exist.
     */
    sceneIndices?: number[];
  } = {},
): Promise<{ reportPath: string; report: VideoExecutionReport }> {
  const root = options.root ?? process.cwd();
  const productionMode = options.productionMode ?? 'storyboard';
  const dryRun = options.dryRun ?? false;
  const sceneIndices = options.sceneIndices;
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const plan = await buildExecutionPlan(projectSlug, root, productionMode, { env: options.env });
  const generatedAt = new Date().toISOString();

  // Candidate-mode detection. A project enters candidate mode when either:
  //   1. `scene-candidates.json` already exists (operator has opted in, or a
  //      prior run was in candidate mode); or
  //   2. `--scene <n>` was passed for this run (partial rerun implies
  //      candidates).
  // When neither signal is present, we stay on the legacy path — direct
  // asset-manifest writes, no candidate artifact touched.
  const candidateArtifactExists = existsSync(sceneCandidatesPathFor(root, projectSlug));
  const candidateMode = candidateArtifactExists || Array.isArray(sceneIndices);

  if (!plan.ready || !plan.recommendedRouteId) {
    const blockedReport: VideoExecutionReport = {
      projectSlug,
      productionMode: plan.productionMode,
      operationKind: plan.operationKind,
      routeId: plan.recommendedRouteId,
      status: 'blocked',
      dryRun,
      generatedAt,
      blockers: [...plan.blockers],
      executedSteps: ['validated-readiness', 'selected-provider-route'],
    };

    const blockedReportPath = await writeArtifact(workspace, 'execution-report', blockedReport);
    await appendProjectEvent(workspace, {
      type: 'execution.report.written',
      recordedAt: blockedReport.generatedAt,
      payload: { reportPath: blockedReportPath, status: blockedReport.status, routeId: blockedReport.routeId, dryRun: blockedReport.dryRun },
    });
    await writeStageCheckpoint(workspace, {
      stage: 'assets',
      status: 'failed',
      generatedAt: blockedReport.generatedAt,
      artifacts: {
        'execution-report': blockedReportPath,
      },
      summary: 'Execution blocked.',
      issues: blockedReport.blockers,
      nextAction: 'Resolve blockers or add runtime support.',
    });
    await updateProjectManifestState(workspace, {
      updatedAt: blockedReport.generatedAt,
      currentStage: 'assets',
      lastCompletedStage: 'storyboard',
      lastCheckpointStatus: 'failed',
    });

    return { reportPath: blockedReportPath, report: blockedReport };
  }

  const skipDirectorPreflight = (options.env ?? process.env).SKIP_DIRECTOR_PREFLIGHT === '1';

  if (plan.productionMode === 'director' && (options.env ?? process.env).DIRECTOR_AUTO_FIX_CONTENT === '1') {
    const autoFix = await autoFixDirectorStoryboardContent(projectSlug, root);
    if (autoFix) {
      await appendVideoContextChangelog(
        root,
        `${generatedAt} director-auto-fix: applied ${autoFix.changeCount} content substitution(s) for project ${projectSlug}.`,
      );
    }
  }

  const directorPreflight = plan.productionMode === 'director' && !skipDirectorPreflight
    ? await runDirectorPreflight(projectSlug, root)
    : null;

  if (directorPreflight && !directorPreflight.pass) {
    const review = await writeStoryboardMarkdownReview({
      projectSlug,
      root,
      executionPlan: plan,
      preflight: directorPreflight,
      generatedAt,
    });
    const report: VideoExecutionReport = {
      projectSlug,
      productionMode: plan.productionMode,
      operationKind: plan.operationKind,
      routeId: plan.recommendedRouteId,
      status: 'blocked',
      dryRun,
      generatedAt,
      blockers: directorPreflight.errors.map((issue) => issue.message),
      executedSteps: ['validated-readiness', 'selected-provider-route', 'ran-director-preflight', 'rendered-storyboard-review'],
    };
    const reportPath = await writeArtifact(workspace, 'execution-report', report);
    await appendProjectEvent(workspace, {
      type: 'director.preflight.blocked',
      recordedAt: generatedAt,
      payload: { markdownPath: review.markdownPath, reportPath, errorCount: directorPreflight.errors.length },
    });
    await writeStageCheckpoint(workspace, {
      stage: 'storyboard',
      status: 'failed',
      generatedAt,
      artifacts: {
        storyboard: artifactPathFor(workspace, 'storyboard'),
        'execution-report': reportPath,
      },
      summary: 'Director preflight blocked execution before provider submission.',
      issues: directorPreflight.errors.map((issue) => issue.message),
      nextAction: `Review ${review.markdownPath}, fix the preflight errors, and rerun director execution.`,
    });
    await updateProjectManifestState(workspace, {
      updatedAt: generatedAt,
      currentStage: 'storyboard',
      lastCompletedStage: 'brief',
      lastCheckpointStatus: 'failed',
    });
    await appendVideoContextChangelog(
      root,
      `${generatedAt} director-preflight: blocked project ${projectSlug} before provider submission.`,
    );
    return { reportPath, report };
  }

  if (plan.productionMode === 'director' && skipDirectorPreflight) {
    await appendProjectEvent(workspace, {
      type: 'director.preflight.skipped',
      recordedAt: generatedAt,
      payload: { reason: 'SKIP_DIRECTOR_PREFLIGHT=1' },
    });
    await appendVideoContextChangelog(
      root,
      `${generatedAt} director-preflight: skipped for project ${projectSlug}.`,
    );
  }

  const approvalStatus = plan.productionMode === 'director'
    ? await buildProjectStatusReport(projectSlug, root, plan.productionMode)
    : null;

  if (plan.productionMode === 'director' && approvalStatus?.storyboardReviewStale) {
    const reviewPath = approvalStatus.storyboardReviewPath ?? join(workspace.projectDir, 'storyboard.md');
    const refreshCommand = buildStoryboardRefreshCommand(projectSlug, root);
    const report: VideoExecutionReport = {
      projectSlug,
      productionMode: plan.productionMode,
      operationKind: plan.operationKind,
      routeId: plan.recommendedRouteId,
      status: 'blocked',
      dryRun,
      generatedAt,
      blockers: [
        `Storyboard review is stale. Refresh ${reviewPath} with: ${refreshCommand}`,
      ],
      executedSteps: ['validated-readiness', 'selected-provider-route', 'checked-review-freshness'],
    };
    const reportPath = await writeArtifact(workspace, 'execution-report', report);
    await appendProjectEvent(workspace, {
      type: 'storyboard.review.stale.blocked',
      recordedAt: generatedAt,
      payload: { reportPath, markdownPath: reviewPath },
    });
    await writeStageCheckpoint(workspace, {
      stage: 'storyboard',
      status: 'awaiting-approval',
      generatedAt,
      artifacts: {
        storyboard: artifactPathFor(workspace, 'storyboard'),
        'execution-report': reportPath,
      },
      summary: 'Director execution blocked because the storyboard review is stale.',
      issues: report.blockers,
      nextAction: `Refresh ${reviewPath} with: ${refreshCommand}`,
    });
    await updateProjectManifestState(workspace, {
      updatedAt: generatedAt,
      currentStage: 'storyboard',
      lastCompletedStage: 'brief',
      lastCheckpointStatus: 'awaiting-approval',
    });
    await appendVideoContextChangelog(
      root,
      `${generatedAt} storyboard-review: stale review blocked execution for project ${projectSlug}.`,
    );
    return { reportPath, report };
  }

  if (plan.productionMode === 'director' && !isStoryboardApproved(options.env ?? process.env)) {
    const review = await writeStoryboardMarkdownReview({
      projectSlug,
      root,
      executionPlan: plan,
      preflight: directorPreflight ?? undefined,
      generatedAt,
    });
    const report: VideoExecutionReport = {
      projectSlug,
      productionMode: plan.productionMode,
      operationKind: plan.operationKind,
      routeId: plan.recommendedRouteId,
      status: 'blocked',
      dryRun,
      generatedAt,
      blockers: [
        `Storyboard approval required before director execution. Review ${review.markdownPath} and rerun with: ${buildStoryboardApprovalCommand(projectSlug, root)}`,
      ],
      executedSteps: ['validated-readiness', 'selected-provider-route', 'ran-director-preflight', 'rendered-storyboard-review'],
    };
    const reportPath = await writeArtifact(workspace, 'execution-report', report);
    await appendProjectEvent(workspace, {
      type: 'storyboard.approval.required',
      recordedAt: generatedAt,
      payload: { markdownPath: review.markdownPath, reportPath },
    });
    await writeStageCheckpoint(workspace, {
      stage: 'storyboard',
      status: 'awaiting-approval',
      generatedAt,
      artifacts: {
        storyboard: artifactPathFor(workspace, 'storyboard'),
        'execution-report': reportPath,
      },
      summary: 'Director execution is waiting for storyboard approval.',
      issues: [],
      nextAction: `Review ${review.markdownPath} and rerun with: ${buildStoryboardApprovalCommand(projectSlug, root)}`,
    });
    await updateProjectManifestState(workspace, {
      updatedAt: generatedAt,
      currentStage: 'storyboard',
      lastCompletedStage: 'brief',
      lastCheckpointStatus: 'awaiting-approval',
    });
    await appendVideoContextChangelog(
      root,
      `${generatedAt} storyboard-approval: review required for project ${projectSlug}.`,
    );
    return { reportPath, report };
  }

  if (plan.productionMode === 'director' && isStoryboardApproved(options.env ?? process.env)) {
    const storyboardCheckpoint = await readStageCheckpoint(workspace, 'storyboard');
    await writeStageCheckpoint(workspace, {
      stage: 'storyboard',
      status: 'completed',
      generatedAt,
      artifacts: {
        storyboard: artifactPathFor(workspace, 'storyboard'),
      },
      summary: storyboardCheckpoint?.status === 'awaiting-approval'
        ? 'Storyboard approved for director execution.'
        : (storyboardCheckpoint?.summary ?? 'Storyboard artifact created.'),
      issues: [],
      nextAction: 'Proceed to asset-stage execution.',
    });
    await updateProjectManifestState(workspace, {
      updatedAt: generatedAt,
      currentStage: 'assets',
      lastCompletedStage: 'storyboard',
      lastCheckpointStatus: 'completed',
    });
  }

  let payload;
  try {
    payload = await buildExecutionPayload(projectSlug, plan, root, {
      ...(sceneIndices ? { sceneIndices } : {}),
      resolveChainSeeds: candidateMode,
    });
  } catch (error) {
    // chain-from-prev-source-missing is an operator-visible hard fail — wire it
    // through the execution report so the CLI returns a structured blocker.
    if (error instanceof ChainFromPrevSourceMissingError) {
      const report: VideoExecutionReport = {
        projectSlug,
        productionMode: plan.productionMode,
        operationKind: plan.operationKind,
        routeId: plan.recommendedRouteId,
        status: 'blocked',
        dryRun,
        generatedAt,
        blockers: [error.message],
        executedSteps: ['validated-readiness', 'selected-provider-route', 'prepared-provider-adapter-payload'],
      };
      const reportPath = await writeArtifact(workspace, 'execution-report', report);
      await appendProjectEvent(workspace, {
        type: 'execution.report.written',
        recordedAt: report.generatedAt,
        payload: { reportPath, status: report.status, routeId: report.routeId, dryRun: report.dryRun },
      });
      await writeStageCheckpoint(workspace, {
        stage: 'assets',
        status: 'failed',
        generatedAt: report.generatedAt,
        artifacts: { 'execution-report': reportPath },
        summary: 'Execution blocked: chain-from-prev source missing.',
        issues: report.blockers,
        nextAction: `Select a candidate for scene ${error.sourceSceneIndex} or unchain scene ${error.sceneIndex}.`,
      });
      await updateProjectManifestState(workspace, {
        updatedAt: report.generatedAt,
        currentStage: 'assets',
        lastCompletedStage: 'storyboard',
        lastCheckpointStatus: 'failed',
      });
      return { reportPath, report };
    }
    throw error;
  }

  let report: VideoExecutionReport;
  if (dryRun) {
    report = {
      projectSlug,
      productionMode: plan.productionMode,
      operationKind: plan.operationKind,
      routeId: plan.recommendedRouteId,
      status: 'dry-run-complete',
      dryRun: true,
      generatedAt,
      blockers: [],
      executedSteps: ['validated-readiness', 'selected-provider-route', 'prepared-provider-adapter-payload', 'simulated-execution-plan'],
      taskCount: payload.tasks.length,
    };
  } else {
    try {
      const submission = await submitExecutionPayload(payload, { env: options.env });
      report = {
        projectSlug,
        productionMode: plan.productionMode,
        operationKind: plan.operationKind,
        routeId: plan.recommendedRouteId,
        status: 'live-submitted',
        dryRun: false,
        generatedAt,
        blockers: [],
        executedSteps: ['validated-readiness', 'selected-provider-route', 'prepared-provider-adapter-payload', 'submitted-provider-adapter'],
        taskCount: payload.tasks.length,
        submission,
      };
    } catch (error) {
      report = {
        projectSlug,
        productionMode: plan.productionMode,
        operationKind: plan.operationKind,
        routeId: plan.recommendedRouteId,
        status: 'blocked',
        dryRun: false,
        generatedAt,
        blockers: [...plan.blockers, (error as Error).message],
        executedSteps: ['validated-readiness', 'selected-provider-route', 'prepared-provider-adapter-payload'],
        taskCount: payload.tasks.length,
      };
    }
  }

  // Candidate ingest — only in candidate mode, only when the payload actually
  // went out the door (live-submitted or dry-run-complete). We do NOT append
  // candidates for blocked runs because no job id exists to track them.
  if (candidateMode && (report.status === 'live-submitted' || report.status === 'dry-run-complete')) {
    const candidates = await readSceneCandidatesArtifact(root, projectSlug);
    const selection = await readSceneSelectionArtifact(root, projectSlug);

    let nextCandidates: SceneCandidatesArtifact = candidates;
    let nextSelection: SceneSelectionArtifact = selection;
    const created: Array<{ sceneIndex: number; candidateId: string }> = [];
    const externalJobId = report.submission?.externalJobId ?? undefined;

    for (const task of payload.tasks) {
      const candidateId = nextCandidateId(nextCandidates, task.sceneIndex);
      const round = maxRoundForScene(nextCandidates, task.sceneIndex) + 1;
      const candidate: SceneCandidate = {
        id: candidateId,
        generationRound: round,
        prompt: task.prompt,
        route: plan.recommendedRouteId,
        submittedAt: report.generatedAt,
        status: 'pending',
        outputs: [],
        source: {
          executionRound: round,
          adapter: 'builtin',
          ...(externalJobId ? { externalJobId } : {}),
          chainedFromCandidateId: task.chainedFromCandidateId ?? null,
        },
      };
      nextCandidates = appendCandidate(nextCandidates, task.sceneIndex, candidate);
      nextSelection = markPending(nextSelection, task.sceneIndex, [candidateId]);
      created.push({ sceneIndex: task.sceneIndex, candidateId });
    }

    await writeSceneCandidatesArtifact(root, projectSlug, nextCandidates);
    await writeSceneSelectionArtifact(root, projectSlug, nextSelection);

    for (const entry of created) {
      await appendProjectEvent(workspace, {
        type: 'scene-candidate.submitted',
        recordedAt: report.generatedAt,
        payload: {
          sceneIndex: entry.sceneIndex,
          candidateId: entry.candidateId,
          routeId: plan.recommendedRouteId,
          ...(externalJobId ? { externalJobId } : {}),
        },
      });
    }

    report = { ...report, candidatesByScene: created };
  }

  const reportPath = await writeArtifact(workspace, 'execution-report', report);
  await appendProjectEvent(workspace, {
    type: 'execution.report.written',
    recordedAt: report.generatedAt,
    payload: { reportPath, status: report.status, routeId: report.routeId, dryRun: report.dryRun },
  });
  await appendGenerationTelemetry(workspace, buildGenerationTelemetryFromReport({
    report,
    payload,
    recordedAt: report.generatedAt,
  }));
  await writeStageCheckpoint(workspace, {
    stage: 'assets',
    status: report.status === 'dry-run-complete'
      ? 'completed'
      : report.status === 'live-submitted'
        ? 'pending'
        : 'failed',
    generatedAt: report.generatedAt,
    artifacts: {
      'execution-report': reportPath,
    },
    summary: report.status === 'dry-run-complete'
      ? 'Execution dry-run completed.'
      : report.status === 'live-submitted'
        ? 'Execution submitted to provider adapter.'
        : 'Execution blocked.',
    issues: report.blockers,
    nextAction: report.status === 'dry-run-complete'
      ? 'Proceed to live provider execution.'
      : report.status === 'live-submitted'
        ? 'Poll provider job status and ingest outputs.'
        : 'Resolve blockers or add runtime support.',
  });
  await updateProjectManifestState(workspace, {
    updatedAt: report.generatedAt,
    currentStage: report.status === 'dry-run-complete' ? 'review' : 'assets',
    lastCompletedStage: report.status === 'dry-run-complete' ? 'assets' : 'storyboard',
    lastCheckpointStatus: report.status === 'dry-run-complete'
      ? 'completed'
      : report.status === 'live-submitted'
        ? 'pending'
        : 'failed',
  });
  await appendVideoContextChangelog(
    root,
    `${report.generatedAt} produce: ${report.status} for project ${projectSlug}${report.routeId ? ` via ${report.routeId}` : ''}.`,
  );

  return { reportPath, report };
}
