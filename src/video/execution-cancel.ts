import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { artifactPathFor, writeArtifact } from './artifact-store.js';
import { writeStageCheckpoint } from './checkpoints.js';
import { appendProjectEvent } from './events.js';
import { cancelExecutionPayload } from './execution-runtime.js';
import { ensureProjectWorkspace, readProjectManifest, resolveProjectWorkspace, updateProjectManifestState } from './workspace.js';
import type { VideoExecutionCancelResult, VideoExecutionReport, VideoProductionMode } from './types.js';

export async function cancelExecution(
  projectSlug: string,
  options: {
    root?: string;
    productionMode?: VideoProductionMode;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<{
  reportPath: string;
  report: VideoExecutionReport;
  cancellation: VideoExecutionCancelResult;
}> {
  const root = options.root ?? process.cwd();
  const resolvedWorkspace = resolveProjectWorkspace(projectSlug, root);
  const projectManifest = await readProjectManifest(resolvedWorkspace);
  if (!projectManifest) {
    throw new Error(`Execution cancel unavailable for ${projectSlug}: project manifest is missing.`);
  }
  const workspace = await ensureProjectWorkspace(projectSlug, root);
  const reportPath = artifactPathFor(workspace, 'execution-report');
  if (!existsSync(reportPath)) {
    throw new Error(`Execution cancel unavailable for ${projectSlug}: execution-report artifact is missing.`);
  }

  const report = JSON.parse(await readFile(reportPath, 'utf-8')) as VideoExecutionReport;
  if (!report.routeId || !report.submission?.externalJobId) {
    throw new Error(`Execution cancel unavailable for ${projectSlug}: last execution report has no live adapter job id.`);
  }

  const cancellation = await cancelExecutionPayload({
    projectSlug,
    routeId: report.routeId,
    externalJobId: report.submission.externalJobId,
    outputDir: `${workspace.projectDir}/outputs`,
    workspaceRoot: workspace.root,
  }, {
    env: options.env,
  });

  const generatedAt = new Date().toISOString();
  const issues = cancellation.status === 'unsupported'
    ? [...cancellation.issues]
    : ['Execution cancelled by operator.', ...cancellation.issues];

  const updatedReport: VideoExecutionReport = {
    ...report,
    status: 'blocked',
    poll: {
      lastCheckedAt: generatedAt,
      status: 'failed',
      issues,
      rawResult: cancellation.rawResult,
    },
  };

  const updatedReportPath = await writeArtifact(workspace, 'execution-report', updatedReport);
  await writeStageCheckpoint(workspace, {
    stage: 'assets',
    status: 'failed',
    generatedAt,
    artifacts: {
      'execution-report': updatedReportPath,
    },
    summary: cancellation.status === 'unsupported'
      ? 'Execution cancel requested but the current route does not support cancellation.'
      : 'Execution cancelled by operator.',
    issues,
    nextAction: cancellation.status === 'unsupported'
      ? 'Wait for provider completion or switch to a route that supports cancellation.'
      : 'Resolve the issue and resubmit execution when ready.',
  });
  await updateProjectManifestState(workspace, {
    updatedAt: generatedAt,
    currentStage: 'assets',
    lastCompletedStage: 'storyboard',
    lastCheckpointStatus: 'failed',
  });
  await appendProjectEvent(workspace, {
    type: 'execution.cancelled',
    recordedAt: generatedAt,
    payload: {
      reportPath: updatedReportPath,
      routeId: report.routeId,
      externalJobId: cancellation.externalJobId,
      status: cancellation.status,
    },
  });

  return {
    reportPath: updatedReportPath,
    report: updatedReport,
    cancellation,
  };
}
