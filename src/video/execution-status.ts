import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { artifactPathFor, writeArtifact } from './artifact-store.js';
import { writeStageCheckpoint } from './checkpoints.js';
import { appendProjectEvent } from './events.js';
import {
  appendGenerationTelemetry,
  buildGenerationTelemetryFromPoll,
} from './generation-telemetry.js';
import { pollExecutionPayload } from './execution-runtime.js';
import { deriveAssetManifestFromSelection } from './scene-candidates.js';
import {
  readSceneCandidatesArtifact,
  sceneCandidatesPathFor,
  writeSceneCandidatesArtifact,
} from './scene-candidate-store.js';
import { markPending } from './scene-selection.js';
import {
  readSceneSelectionArtifact,
  writeSceneSelectionArtifact,
} from './scene-selection-store.js';
import { buildProjectStatusReport } from './status.js';
import { ensureProjectWorkspace, readProjectManifest, resolveProjectWorkspace, updateProjectManifestState } from './workspace.js';
import type { AssetManifestArtifact } from './artifacts.js';
import type {
  SceneCandidate,
  SceneCandidateOutput,
  VideoExecutionPollResult,
  VideoExecutionReport,
  VideoProductionMode,
} from './types.js';

function mergeAssets(
  existing: AssetManifestArtifact['assets'],
  incoming: AssetManifestArtifact['assets'],
): AssetManifestArtifact['assets'] {
  const byId = new Map(existing.map((asset) => [asset.id, asset]));
  for (const asset of incoming) {
    byId.set(asset.id, asset);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export async function refreshExecutionStatus(
  projectSlug: string,
  options: {
    root?: string;
    productionMode?: VideoProductionMode;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{
  reportPath: string;
  report: VideoExecutionReport;
  poll: VideoExecutionPollResult;
  assetManifestPath?: string;
}> {
  const root = options.root ?? process.cwd();
  const resolvedWorkspace = resolveProjectWorkspace(projectSlug, root);
  const projectManifest = await readProjectManifest(resolvedWorkspace);
  if (!projectManifest) {
    const now = new Date().toISOString();
    const reportPath = artifactPathFor(resolvedWorkspace, 'execution-report');
    const issues = [
      `Execution status unavailable for ${projectSlug}: project manifest is missing. Run \`vclaw video init ${projectSlug}\` first.`,
    ];
    const poll: VideoExecutionPollResult = {
      status: 'failed',
      externalJobId: null,
      outputs: [],
      issues,
      rawResult: {
        reason: 'missing-project-manifest',
      },
    };
    const report: VideoExecutionReport = {
      projectSlug,
      productionMode: options.productionMode ?? 'storyboard',
      operationKind: 'text-to-video',
      routeId: null,
      status: 'blocked',
      dryRun: false,
      generatedAt: now,
      blockers: issues,
      executedSteps: ['execution-status-requested'],
      taskCount: 0,
      poll: {
        lastCheckedAt: now,
        status: 'failed',
        issues,
        rawResult: poll.rawResult,
      },
    };
    return {
      reportPath,
      report,
      poll,
    };
  }
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const status = await buildProjectStatusReport(projectSlug, root, options.productionMode ?? 'storyboard');
  if (status.productionMode === 'director' && status.storyboardReviewStale) {
    throw new Error(
      `Execution status unavailable for ${projectSlug}: storyboard review is stale. Refresh ${status.storyboardReviewPath ?? 'storyboard.md'} before continuing.`,
    );
  }
  const reportPath = artifactPathFor(workspace, 'execution-report');
  if (!existsSync(reportPath)) {
    const lastCheckedAt = new Date().toISOString();
    const issues = ['Execution status unavailable: execution-report artifact is missing. Run execution first.'];
    const poll: VideoExecutionPollResult = {
      status: 'failed',
      externalJobId: null,
      outputs: [],
      issues,
      rawResult: {
        reason: 'missing-execution-report',
      },
    };
    const updatedReport: VideoExecutionReport = {
      projectSlug,
      productionMode: status.productionMode,
      operationKind: 'text-to-video',
      routeId: null,
      status: 'blocked',
      dryRun: false,
      generatedAt: lastCheckedAt,
      blockers: issues,
      executedSteps: ['execution-status-requested'],
      taskCount: 0,
      poll: {
        lastCheckedAt,
        status: 'failed',
        issues,
        rawResult: poll.rawResult,
      },
    };
    await writeStageCheckpoint(workspace, {
      stage: 'assets',
      status: 'failed',
      generatedAt: lastCheckedAt,
      artifacts: {
        'execution-report': reportPath,
      },
      summary: 'Execution status refresh failed.',
      issues,
      nextAction: 'Run execution before polling execution status.',
    });
    await updateProjectManifestState(workspace, {
      updatedAt: lastCheckedAt,
      currentStage: 'assets',
      lastCompletedStage: 'storyboard',
      lastCheckpointStatus: 'failed',
    });
    await writeArtifact(workspace, 'execution-report', updatedReport);
    await appendProjectEvent(workspace, {
      type: 'execution.status.refreshed',
      recordedAt: lastCheckedAt,
      payload: {
        reportPath,
        status: 'failed',
        externalJobId: null,
        outputsIngested: 0,
      },
    });
    return {
      reportPath,
      report: updatedReport,
      poll,
    };
  }

  const report = JSON.parse(await readFile(reportPath, 'utf-8')) as VideoExecutionReport;
  if (!report.routeId || !report.submission?.externalJobId) {
    const lastCheckedAt = new Date().toISOString();
    const reportHasBlockers = Array.isArray(report.blockers) && report.blockers.length > 0;
    const issues = reportHasBlockers
      ? [...report.blockers]
      : !report.routeId
        ? ['Execution status unavailable: last execution report has no provider route id.']
        : ['Execution status unavailable: last execution report has no live adapter job id.'];
    const reason = reportHasBlockers
      ? 'execution-already-blocked'
      : !report.routeId
        ? 'missing-provider-route-id'
        : 'missing-live-adapter-job-id';
    const nextAction = reportHasBlockers
      ? 'Resolve execution blockers and rerun execution.'
      : 'Rerun execution to create a live adapter job id before polling status.';
    const poll: VideoExecutionPollResult = {
      status: 'failed',
      externalJobId: null,
      outputs: [],
      issues,
      rawResult: {
        reason,
      },
    };
    const updatedReport: VideoExecutionReport = {
      ...report,
      poll: {
        lastCheckedAt,
        status: 'failed',
        issues,
        rawResult: poll.rawResult,
      },
    };
    await writeStageCheckpoint(workspace, {
      stage: 'assets',
      status: 'failed',
      generatedAt: lastCheckedAt,
      artifacts: {
        'execution-report': reportPath,
      },
      summary: 'Execution status refresh failed.',
      issues,
      nextAction,
    });
    await updateProjectManifestState(workspace, {
      updatedAt: lastCheckedAt,
      currentStage: 'assets',
      lastCompletedStage: 'storyboard',
      lastCheckpointStatus: 'failed',
    });
    await writeArtifact(workspace, 'execution-report', updatedReport);
    await appendProjectEvent(workspace, {
      type: 'execution.status.refreshed',
      recordedAt: lastCheckedAt,
      payload: {
        reportPath,
        status: 'failed',
        externalJobId: null,
        outputsIngested: 0,
      },
    });
    return {
      reportPath,
      report: updatedReport,
      poll,
    };
  }

  const poll = await pollExecutionPayload({
    projectSlug,
    routeId: report.routeId,
    externalJobId: report.submission.externalJobId,
    outputDir: `${workspace.projectDir}/outputs`,
  }, {
    env: options.env,
  });
  const completedWithoutOutputs = poll.status === 'completed' && poll.outputs.length === 0;
  const normalizedPollStatus: VideoExecutionPollResult['status'] = completedWithoutOutputs ? 'failed' : poll.status;
  const normalizedIssues = completedWithoutOutputs
    ? [...poll.issues, 'Execution completed but provider returned no outputs to ingest.']
    : poll.issues;

  const pollMetadata = {
    lastCheckedAt: new Date().toISOString(),
    status: normalizedPollStatus,
    issues: normalizedIssues,
    ...(normalizedPollStatus === 'completed' ? { outputsIngested: poll.outputs.length } : {}),
    rawResult: poll.rawResult,
  };

  const updatedReport: VideoExecutionReport = {
    ...report,
    poll: pollMetadata,
  };
  const lastCheckedAt = pollMetadata.lastCheckedAt;

  // Candidate-mode detection mirrors executeProject: if a candidate artifact
  // exists, or the last report carries `candidatesByScene`, treat this poll as
  // a candidate-mode poll and route output ingestion through the candidate
  // store. Otherwise we keep the legacy direct-asset-manifest behavior.
  const candidateMode = existsSync(sceneCandidatesPathFor(root, projectSlug))
    || Array.isArray(report.candidatesByScene);

  let assetManifestPath: string | undefined;
  if (normalizedPollStatus === 'completed') {
    if (candidateMode) {
      // Candidate path — update per-scene candidates, append to
      // pendingCandidateIds, then re-derive asset-manifest from selection.
      const candidates = await readSceneCandidatesArtifact(root, projectSlug);
      const selection = await readSceneSelectionArtifact(root, projectSlug);

      // Group poll outputs by sceneIndex. Outputs without a sceneIndex are
      // attached to every candidate we created for this run (preserves the
      // legacy fallback when adapters don't tag outputs).
      const outputsByScene = new Map<number, SceneCandidateOutput[]>();
      const untaggedOutputs: SceneCandidateOutput[] = [];
      for (const out of poll.outputs) {
        const kind = out.kind === 'image' || out.kind === 'video' || out.kind === 'audio'
          ? out.kind
          : null;
        if (!kind) continue;
        const candidateOutput: SceneCandidateOutput = { kind, path: out.path };
        if (typeof out.sceneIndex === 'number') {
          const existing = outputsByScene.get(out.sceneIndex) ?? [];
          existing.push(candidateOutput);
          outputsByScene.set(out.sceneIndex, existing);
        } else {
          untaggedOutputs.push(candidateOutput);
        }
      }

      const candidateIdsByScene = new Map<number, string>();
      for (const entry of report.candidatesByScene ?? []) {
        candidateIdsByScene.set(entry.sceneIndex, entry.candidateId);
      }

      let updatedCandidates = candidates;
      let updatedSelection = selection;
      for (const [sceneIndex, candidateId] of candidateIdsByScene) {
        const sceneOutputs = [
          ...(outputsByScene.get(sceneIndex) ?? []),
          ...untaggedOutputs,
        ];
        const sceneIdx = updatedCandidates.scenes.findIndex((s) => s.sceneIndex === sceneIndex);
        if (sceneIdx === -1) continue;
        const candIdx = updatedCandidates.scenes[sceneIdx].candidates.findIndex(
          (c) => c.id === candidateId,
        );
        if (candIdx === -1) continue;
        const prev = updatedCandidates.scenes[sceneIdx].candidates[candIdx];
        const next: SceneCandidate = {
          ...prev,
          status: 'completed',
          completedAt: lastCheckedAt,
          outputs: sceneOutputs.length > 0 ? sceneOutputs : prev.outputs,
        };
        const nextCandidates = [...updatedCandidates.scenes[sceneIdx].candidates];
        nextCandidates[candIdx] = next;
        const nextScenes = [...updatedCandidates.scenes];
        nextScenes[sceneIdx] = {
          ...updatedCandidates.scenes[sceneIdx],
          candidates: nextCandidates,
        };
        updatedCandidates = { ...updatedCandidates, scenes: nextScenes };
        updatedSelection = markPending(updatedSelection, sceneIndex, [candidateId]);
      }

      await writeSceneCandidatesArtifact(root, projectSlug, updatedCandidates);
      await writeSceneSelectionArtifact(root, projectSlug, updatedSelection);

      // Derive asset-manifest from selection so the legacy review/publish
      // readers keep seeing a coherent manifest. Before any operator has
      // selected a winner, this will be an empty `assets` array.
      const derived = deriveAssetManifestFromSelection(projectSlug, updatedCandidates, updatedSelection);
      assetManifestPath = await writeArtifact(workspace, 'asset-manifest', derived);
    } else {
      const existingAssetManifest = existsSync(artifactPathFor(workspace, 'asset-manifest'))
        ? JSON.parse(await readFile(artifactPathFor(workspace, 'asset-manifest'), 'utf-8')) as AssetManifestArtifact
        : { projectSlug, assets: [] };
      const nextAssetManifest: AssetManifestArtifact = {
        projectSlug,
        assets: mergeAssets(existingAssetManifest.assets ?? [], poll.outputs),
      };
      assetManifestPath = await writeArtifact(workspace, 'asset-manifest', nextAssetManifest);
    }
    await writeStageCheckpoint(workspace, {
      stage: 'assets',
      status: 'completed',
      generatedAt: lastCheckedAt,
      artifacts: {
        'asset-manifest': assetManifestPath,
        'execution-report': reportPath,
      },
      summary: 'Live execution completed and outputs were ingested.',
      issues: [],
      nextAction: 'Run review on the generated outputs.',
    });
    await updateProjectManifestState(workspace, {
      updatedAt: lastCheckedAt,
      currentStage: 'review',
      lastCompletedStage: 'assets',
      lastCheckpointStatus: 'completed',
    });
  } else if (normalizedPollStatus === 'failed') {
    await writeStageCheckpoint(workspace, {
      stage: 'assets',
      status: 'failed',
      generatedAt: lastCheckedAt,
      artifacts: {
        'execution-report': reportPath,
      },
      summary: 'Live execution failed.',
      issues: normalizedIssues,
      nextAction: 'Resolve provider issues and resubmit execution.',
    });
    await updateProjectManifestState(workspace, {
      updatedAt: lastCheckedAt,
      currentStage: 'assets',
      lastCompletedStage: 'storyboard',
      lastCheckpointStatus: 'failed',
    });
  } else {
    await writeStageCheckpoint(workspace, {
      stage: 'assets',
      status: 'pending',
      generatedAt: lastCheckedAt,
      artifacts: {
        'execution-report': reportPath,
      },
      summary: 'Live execution is still pending.',
      issues: normalizedIssues,
      nextAction: 'Poll execution status again later.',
    });
    await updateProjectManifestState(workspace, {
      updatedAt: lastCheckedAt,
      currentStage: 'assets',
      lastCompletedStage: 'storyboard',
      lastCheckpointStatus: 'pending',
    });
  }

  await writeArtifact(workspace, 'execution-report', updatedReport);
  await appendProjectEvent(workspace, {
    type: 'execution.status.refreshed',
    recordedAt: lastCheckedAt,
    payload: {
      reportPath,
      status: normalizedPollStatus,
      externalJobId: poll.externalJobId,
      outputsIngested: poll.outputs.length,
    },
  });
  await appendGenerationTelemetry(workspace, buildGenerationTelemetryFromPoll({
    report: updatedReport,
    poll: {
      ...poll,
      status: normalizedPollStatus,
      issues: normalizedIssues,
    },
    recordedAt: lastCheckedAt,
  }));

  return {
    reportPath,
    report: updatedReport,
    poll,
    ...(assetManifestPath ? { assetManifestPath } : {}),
  };
}
