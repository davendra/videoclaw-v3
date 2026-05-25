import { doctorProject } from './doctor.js';
import { buildProjectIndex } from './project-index.js';
import { buildProjectStatusReport } from './status.js';
import type { VideoProductionMode } from './types.js';

export interface VideoProjectNextAction {
  slug: string;
  opsStatus: string;
  nextStage: string | null;
  platform?: string;
  legacyImportSummary?: {
    manifestPresent?: boolean;
    queueFilePresent?: boolean;
    queueStatusMismatch?: boolean;
    nestedOutputRootDetected?: boolean;
  };
  storyboardReviewState?: 'missing' | 'current' | 'stale';
  storyboardReviewPath?: string;
  storyboardReviewGeneratedAt?: string;
  storyboardReviewStale?: boolean;
  action: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface VideoPortfolioNextActions {
  generatedAt: string;
  root: string;
  actions: VideoProjectNextAction[];
}

function isOperatorCancelledIssue(message: string | undefined): boolean {
  return Boolean(message && /execution cancelled by operator/i.test(message));
}

function stageToAction(stage: string | null): string {
  switch (stage) {
    case 'brief':
      return 'Create the project brief.';
    case 'storyboard':
      return 'Create or update the storyboard.';
    case 'assets':
      return 'Create or attach required assets.';
    case 'review':
      return 'Review outputs and record a verdict.';
    case 'publish':
      return 'Publish or mark the final delivery state.';
    case null:
      return 'No action required.';
    default:
      return `Continue stage: ${stage}`;
  }
}

export async function buildNextActions(
  root = process.cwd(),
  productionMode: VideoProductionMode = 'storyboard',
): Promise<VideoPortfolioNextActions> {
  const index = await buildProjectIndex(root, productionMode);
  const actions: VideoProjectNextAction[] = [];

  for (const project of index.projects) {
    if (project.opsStatus === 'complete' || project.opsStatus === 'missing') {
      continue;
    }

    if (project.blockedBy && project.blockedBy.length > 0) {
      actions.push({
        slug: project.slug,
        opsStatus: project.opsStatus,
        nextStage: project.nextStage,
        ...(project.platform ? { platform: project.platform } : {}),
        ...(project.legacyImportSummary ? { legacyImportSummary: project.legacyImportSummary } : {}),
        action: 'Resolve upstream dependency blockers.',
        reason: project.blockedReason
          ? `${project.blockedReason} (blocked by: ${project.blockedBy.join(', ')})`
          : `Blocked by: ${project.blockedBy.join(', ')}`,
        priority: 'high',
      });
      continue;
    }

    if (project.dueRisk === 'overdue') {
      actions.push({
        slug: project.slug,
        opsStatus: project.opsStatus,
        nextStage: project.nextStage,
        ...(project.platform ? { platform: project.platform } : {}),
        action: 'Resolve overdue delivery risk immediately.',
        reason: project.dueDate
          ? `Project is overdue relative to due date ${project.dueDate}.`
          : 'Project is marked overdue.',
        priority: 'high',
      });
      continue;
    }

    if (project.dueRisk === 'soon') {
      actions.push({
        slug: project.slug,
        opsStatus: project.opsStatus,
        nextStage: project.nextStage,
        ...(project.platform ? { platform: project.platform } : {}),
        action: 'Advance the next stage before the due date slips.',
        reason: project.dueDate
          ? `Project is due soon (${project.dueDate}).`
          : 'Project is due soon.',
        priority: 'high',
      });
      continue;
    }

    if (project.opsStatus === 'blocked') {
      const doctor = await doctorProject(project.slug, root, project.productionMode);
      const issue = doctor.issues[0]?.message ?? 'Project has blocking health issues.';
      actions.push({
        slug: project.slug,
        opsStatus: project.opsStatus,
        nextStage: project.nextStage,
        ...(project.platform ? { platform: project.platform } : {}),
        ...(project.legacyImportSummary ? { legacyImportSummary: project.legacyImportSummary } : {}),
        action: isOperatorCancelledIssue(issue)
          ? 'Resubmit execution or intentionally leave the run cancelled.'
          : 'Fix project health blockers.',
        reason: issue,
        priority: 'high',
      });
      continue;
    }

    if (project.legacyImportSummary?.queueStatusMismatch || project.legacyImportSummary?.nestedOutputRootDetected) {
      const reasons: string[] = [];
      if (project.legacyImportSummary.queueStatusMismatch) {
        reasons.push('queue status disagrees with discovered legacy outputs');
      }
      if (project.legacyImportSummary.nestedOutputRootDetected) {
        reasons.push('nested output roots were detected');
      }
      actions.push({
        slug: project.slug,
        opsStatus: project.opsStatus,
        nextStage: project.nextStage,
        ...(project.platform ? { platform: project.platform } : {}),
        legacyImportSummary: project.legacyImportSummary,
        action: 'Reconcile imported legacy state before resuming execution.',
        reason: `Legacy import diagnostics need reconciliation: ${reasons.join('; ')}.`,
        priority: 'high',
      });
      continue;
    }

    const status = await buildProjectStatusReport(project.slug, root, project.productionMode);
    const reviewCheckpoint = status.checkpoints.find((checkpoint) => checkpoint.stage === 'review');
    const storyboardCheckpoint = status.checkpoints.find((checkpoint) => checkpoint.stage === 'storyboard');
    const nextActionFromCheckpoint = status.checkpoints
      .slice()
      .reverse()
      .find((checkpoint) => checkpoint.nextAction)?.nextAction;
    const canonicalReviewAction = reviewCheckpoint?.status === 'completed'
      ? (reviewCheckpoint.nextAction ?? 'Publish the project.')
      : (
          reviewCheckpoint?.nextAction && reviewCheckpoint.nextAction !== 'Ready for publish handoff.'
            ? reviewCheckpoint.nextAction
            : 'Resolve review findings before publishing.'
        );

    if (storyboardCheckpoint?.status === 'awaiting-approval') {
      actions.push({
        slug: project.slug,
        opsStatus: project.opsStatus,
        nextStage: project.nextStage,
        ...(project.platform ? { platform: project.platform } : {}),
        ...(project.legacyImportSummary ? { legacyImportSummary: project.legacyImportSummary } : {}),
        ...(status.storyboardReviewState ? { storyboardReviewState: status.storyboardReviewState } : {}),
        ...(status.storyboardReviewPath ? { storyboardReviewPath: status.storyboardReviewPath } : {}),
        ...(status.storyboardReviewGeneratedAt ? { storyboardReviewGeneratedAt: status.storyboardReviewGeneratedAt } : {}),
        ...(status.storyboardReviewStale !== undefined ? { storyboardReviewStale: status.storyboardReviewStale } : {}),
        action: status.storyboardReviewStale
          ? 'Refresh the storyboard review and then approve execution.'
          : (nextActionFromCheckpoint ?? 'Review the storyboard and approve execution.'),
        reason: status.storyboardReviewStale
          ? 'Storyboard changed after the last generated review artifact.'
          : 'Storyboard review artifact is ready and execution is waiting for approval.',
        priority: 'high',
      });
      continue;
    }

    if (project.opsStatus === 'needs-review') {
      actions.push({
        slug: project.slug,
        opsStatus: project.opsStatus,
        nextStage: project.nextStage,
        ...(project.platform ? { platform: project.platform } : {}),
        ...(project.legacyImportSummary ? { legacyImportSummary: project.legacyImportSummary } : {}),
        ...(status.storyboardReviewState ? { storyboardReviewState: status.storyboardReviewState } : {}),
        ...(status.storyboardReviewPath ? { storyboardReviewPath: status.storyboardReviewPath } : {}),
        ...(status.storyboardReviewGeneratedAt ? { storyboardReviewGeneratedAt: status.storyboardReviewGeneratedAt } : {}),
        ...(status.storyboardReviewStale !== undefined ? { storyboardReviewStale: status.storyboardReviewStale } : {}),
        action: status.storyboardReviewStale
          ? 'Refresh the stale storyboard review before continuing.'
          : canonicalReviewAction,
        reason: status.storyboardReviewStale
          ? 'Storyboard changed after the last generated review artifact, so current handoff evidence is stale.'
          : reviewCheckpoint?.status === 'retry-required'
          ? 'Review stage requested revisions.'
          : 'Review stage is not yet approved.',
        priority: 'high',
      });
      continue;
    }

    actions.push({
      slug: project.slug,
      opsStatus: project.opsStatus,
      nextStage: project.nextStage,
      ...(project.platform ? { platform: project.platform } : {}),
      ...(project.legacyImportSummary ? { legacyImportSummary: project.legacyImportSummary } : {}),
      ...(status.storyboardReviewState ? { storyboardReviewState: status.storyboardReviewState } : {}),
      ...(status.storyboardReviewPath ? { storyboardReviewPath: status.storyboardReviewPath } : {}),
      ...(status.storyboardReviewGeneratedAt ? { storyboardReviewGeneratedAt: status.storyboardReviewGeneratedAt } : {}),
      action: nextActionFromCheckpoint ?? stageToAction(project.nextStage),
      reason: project.opsStatus === 'planned'
        ? 'Project is initialized but no execution work has started.'
        : 'Project is active and has an unfinished next stage.',
      priority: project.opsStatus === 'planned' ? 'medium' : 'high',
    });
  }

  const priorityOrder: Record<VideoProjectNextAction['priority'], number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  actions.sort((left, right) => {
    const priorityDelta = priorityOrder[left.priority] - priorityOrder[right.priority];
    if (priorityDelta !== 0) return priorityDelta;
    return left.slug.localeCompare(right.slug);
  });

  return {
    generatedAt: new Date().toISOString(),
    root,
    actions,
  };
}
