import type { VideoProjectStatusReport } from './status.js';
import type { VideoProjectManifest } from './workspace.js';

export interface VideoProjectScorecard {
  score: number;
  band: 'poor' | 'fair' | 'good' | 'excellent';
  reasons: string[];
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toBand(score: number): VideoProjectScorecard['band'] {
  if (score >= 85) return 'excellent';
  if (score >= 65) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

export function buildProjectScorecard(input: {
  status: VideoProjectStatusReport;
  manifest: VideoProjectManifest | null;
}): VideoProjectScorecard {
  let score = 0;
  const reasons: string[] = [];

  if (input.status.projectExists) {
    score += 10;
    reasons.push('Project workspace exists.');
  }

  if (input.manifest) {
    score += 10;
    reasons.push('Project manifest exists.');
  }

  const completedStageScore = input.status.completedStages.length * 15;
  score += Math.min(completedStageScore, 75);
  if (input.status.completedStages.length > 0) {
    reasons.push(`${input.status.completedStages.length} stage(s) completed.`);
  }

  if (input.manifest?.owner) {
    score += 5;
    reasons.push('Owner assigned.');
  }

  if (input.manifest?.priority) {
    score += 5;
    reasons.push('Priority set.');
  }

  if (input.manifest?.dueDate) {
    score += 5;
    reasons.push('Due date set.');
  }

  if (input.status.artifactFiles.length > 0) {
    score += Math.min(input.status.artifactFiles.length * 3, 15);
    reasons.push(`${input.status.artifactFiles.length} canonical artifact(s) present.`);
  }

  if (input.status.checkpoints.some((checkpoint) => checkpoint.status === 'retry-required')) {
    score -= 10;
    reasons.push('Project is awaiting review revisions.');
  }

  if (input.status.checkpoints.some((checkpoint) => checkpoint.status === 'failed')) {
    score -= 20;
    reasons.push('Project has failed checkpoint(s).');
  }

  if (input.status.legacyImportSummary?.queueStatusMismatch) {
    score -= 10;
    reasons.push('Legacy import shows queue/output drift.');
  }

  if (input.status.legacyImportSummary?.nestedOutputRootDetected) {
    score -= 5;
    reasons.push('Legacy import shows nested output roots.');
  }

  const finalScore = clampScore(score);
  return {
    score: finalScore,
    band: toBand(finalScore),
    reasons,
  };
}
