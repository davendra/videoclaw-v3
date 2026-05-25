import type { VideoAnalyzeOutput, VideoProductionMode } from './types.js';
import type {
  AssetManifestArtifact,
  BriefArtifact,
  PublishReportArtifact,
  ReviewReportArtifact,
  StoryboardArtifact,
} from './artifacts.js';
import type { ClonePlan } from './template-store.js';
import type { VideoExecutionPlan } from './types.js';
import type { VideoExecutionReport } from './types.js';

export interface ArtifactValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isProductionMode(value: unknown): value is VideoProductionMode {
  return value === 'storyboard' || value === 'director';
}

const STORYBOARD_CAMERA_MOVES = new Set(['push-in', 'pull-out', 'tracking', 'crane', 'orbit', 'static']);

export function validateBriefArtifact(value: unknown): ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  const artifact = value as Partial<BriefArtifact>;
  if (!isNonEmptyString(artifact.title)) issues.push({ severity: 'error', message: 'Brief artifact missing title.' });
  if (!isNonEmptyString(artifact.intent)) issues.push({ severity: 'error', message: 'Brief artifact missing intent.' });
  if (!isProductionMode(artifact.productionMode)) issues.push({ severity: 'error', message: 'Brief artifact has invalid productionMode.' });
  if (!isNonEmptyString(artifact.createdAt)) issues.push({ severity: 'error', message: 'Brief artifact missing createdAt.' });
  return issues;
}

export function validateStoryboardArtifact(value: unknown): ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  const artifact = value as Partial<StoryboardArtifact>;
  if (!isNonEmptyString(artifact.projectSlug)) issues.push({ severity: 'error', message: 'Storyboard artifact missing projectSlug.' });
  if (!isProductionMode(artifact.productionMode)) issues.push({ severity: 'error', message: 'Storyboard artifact has invalid productionMode.' });
  if (!Array.isArray(artifact.scenes) || artifact.scenes.length === 0) {
    issues.push({ severity: 'error', message: 'Storyboard artifact must contain at least one scene.' });
    return issues;
  }
  artifact.scenes.forEach((scene, index) => {
    if (!scene || typeof scene !== 'object') {
      issues.push({ severity: 'error', message: `Storyboard scene ${index} is invalid.` });
      return;
    }
    const maybeScene = scene as Partial<StoryboardArtifact['scenes'][number]>;
    if (!Number.isInteger(maybeScene.sceneIndex)) issues.push({ severity: 'error', message: `Storyboard scene ${index} missing integer sceneIndex.` });
    if (!isNonEmptyString(maybeScene.description)) issues.push({ severity: 'error', message: `Storyboard scene ${index} missing description.` });
    if (maybeScene.scenePrompt !== undefined) {
      if (!maybeScene.scenePrompt || typeof maybeScene.scenePrompt !== 'object') {
        issues.push({ severity: 'error', message: `Storyboard scene ${index} scenePrompt must be an object.` });
      } else {
        const scenePrompt = maybeScene.scenePrompt as Record<string, unknown>;
        if (scenePrompt.imagePrompt !== undefined && typeof scenePrompt.imagePrompt !== 'string') {
          issues.push({ severity: 'error', message: `Storyboard scene ${index} scenePrompt.imagePrompt must be a string.` });
        }
        if (scenePrompt.animationPrompt !== undefined && typeof scenePrompt.animationPrompt !== 'string') {
          issues.push({ severity: 'error', message: `Storyboard scene ${index} scenePrompt.animationPrompt must be a string.` });
        }
        if (scenePrompt.styleFooter !== undefined && typeof scenePrompt.styleFooter !== 'string') {
          issues.push({ severity: 'error', message: `Storyboard scene ${index} scenePrompt.styleFooter must be a string.` });
        }
        if (scenePrompt.cameraMove !== undefined && !STORYBOARD_CAMERA_MOVES.has(String(scenePrompt.cameraMove))) {
          issues.push({ severity: 'error', message: `Storyboard scene ${index} scenePrompt.cameraMove is invalid.` });
        }
      }
    }
  });
  return issues;
}

export function validateAssetManifestArtifact(value: unknown): ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  const artifact = value as Partial<AssetManifestArtifact>;
  if (!isNonEmptyString(artifact.projectSlug)) issues.push({ severity: 'error', message: 'Asset manifest missing projectSlug.' });
  if (!Array.isArray(artifact.assets) || artifact.assets.length === 0) {
    issues.push({ severity: 'error', message: 'Asset manifest must contain at least one asset.' });
    return issues;
  }
  artifact.assets.forEach((asset, index) => {
    if (!asset || typeof asset !== 'object') {
      issues.push({ severity: 'error', message: `Asset ${index} is invalid.` });
      return;
    }
    const maybeAsset = asset as Partial<AssetManifestArtifact['assets'][number]>;
    if (!isNonEmptyString(maybeAsset.id)) issues.push({ severity: 'error', message: `Asset ${index} missing id.` });
    if (!isNonEmptyString(maybeAsset.kind)) issues.push({ severity: 'error', message: `Asset ${index} missing kind.` });
    if (!isNonEmptyString(maybeAsset.path)) issues.push({ severity: 'error', message: `Asset ${index} missing path.` });
  });
  return issues;
}

export function validateReviewReportArtifact(value: unknown): ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  const artifact = value as Partial<ReviewReportArtifact>;
  if (!isNonEmptyString(artifact.projectSlug)) issues.push({ severity: 'error', message: 'Review report missing projectSlug.' });
  if (!(artifact.verdict === 'pass' || artifact.verdict === 'retry' || artifact.verdict === 'fail')) {
    issues.push({ severity: 'error', message: 'Review report has invalid verdict.' });
  }
  if (!isNonEmptyString(artifact.generatedAt)) issues.push({ severity: 'error', message: 'Review report missing generatedAt.' });
  return issues;
}

export function validatePublishReportArtifact(value: unknown): ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  const artifact = value as Partial<PublishReportArtifact>;
  if (!isNonEmptyString(artifact.projectSlug)) issues.push({ severity: 'error', message: 'Publish report missing projectSlug.' });
  if (!(artifact.status === 'ready' || artifact.status === 'published' || artifact.status === 'blocked')) {
    issues.push({ severity: 'error', message: 'Publish report has invalid status.' });
  }
  if (!isNonEmptyString(artifact.generatedAt)) issues.push({ severity: 'error', message: 'Publish report missing generatedAt.' });
  return issues;
}

export function validateAnalyzeOutputArtifact(value: unknown): ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  const artifact = value as Partial<VideoAnalyzeOutput>;
  if (!artifact.reference || !isNonEmptyString(artifact.reference.source)) {
    issues.push({ severity: 'error', message: 'Analyze output missing reference source.' });
  }
  if (!artifact.pacing || !['slow', 'medium', 'fast', 'mixed'].includes(String(artifact.pacing.label))) {
    issues.push({ severity: 'error', message: 'Analyze output has invalid pacing label.' });
  }
  if (!artifact.structure || !Array.isArray(artifact.structure.beats)) {
    issues.push({ severity: 'error', message: 'Analyze output missing structure beats.' });
  }
  if (!artifact.motionClassification || !['motion-clips', 'animated-stills', 'mixed', 'unknown'].includes(String(artifact.motionClassification.primaryMode))) {
    issues.push({ severity: 'error', message: 'Analyze output has invalid motion classification.' });
  }
  if (!Array.isArray(artifact.keep)) issues.push({ severity: 'error', message: 'Analyze output missing keep list.' });
  if (!Array.isArray(artifact.change)) issues.push({ severity: 'error', message: 'Analyze output missing change list.' });
  if (!Array.isArray(artifact.reusableVariables)) issues.push({ severity: 'error', message: 'Analyze output missing reusableVariables list.' });
  if (!isNonEmptyString(artifact.generatedAt)) issues.push({ severity: 'error', message: 'Analyze output missing generatedAt.' });
  return issues;
}

export function validateClonePlanArtifact(value: unknown): ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  const artifact = value as Partial<ClonePlan>;
  if (!isNonEmptyString(artifact.templateName)) issues.push({ severity: 'error', message: 'Clone plan missing templateName.' });
  if (!isNonEmptyString(artifact.projectSlug)) issues.push({ severity: 'error', message: 'Clone plan missing projectSlug.' });
  if (!isNonEmptyString(artifact.intent)) issues.push({ severity: 'error', message: 'Clone plan missing intent.' });
  if (!['slow', 'medium', 'fast', 'mixed'].includes(String(artifact.recommendedPacing))) {
    issues.push({ severity: 'error', message: 'Clone plan has invalid recommendedPacing.' });
  }
  if (!['motion-clips', 'animated-stills', 'mixed', 'unknown'].includes(String(artifact.recommendedMotionMode))) {
    issues.push({ severity: 'error', message: 'Clone plan has invalid recommendedMotionMode.' });
  }
  if (!Array.isArray(artifact.keepFromReference)) issues.push({ severity: 'error', message: 'Clone plan missing keepFromReference.' });
  if (!Array.isArray(artifact.adaptForIntent)) issues.push({ severity: 'error', message: 'Clone plan missing adaptForIntent.' });
  if (!Array.isArray(artifact.reusableVariables)) issues.push({ severity: 'error', message: 'Clone plan missing reusableVariables.' });
  if (!Array.isArray(artifact.beats)) issues.push({ severity: 'error', message: 'Clone plan missing beats.' });
  if (!isNonEmptyString(artifact.generatedAt)) issues.push({ severity: 'error', message: 'Clone plan missing generatedAt.' });
  return issues;
}

export function validateExecutionPlanArtifact(value: unknown): ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  const artifact = value as Partial<VideoExecutionPlan>;
  if (typeof artifact.projectSlug !== 'string' || artifact.projectSlug.trim() === '') {
    issues.push({ severity: 'error', message: 'Execution plan missing projectSlug.' });
  }
  if (!(artifact.productionMode === 'storyboard' || artifact.productionMode === 'director')) {
    issues.push({ severity: 'error', message: 'Execution plan has invalid productionMode.' });
  }
  if (typeof artifact.operationKind !== 'string' || artifact.operationKind.trim() === '') {
    issues.push({ severity: 'error', message: 'Execution plan missing operationKind.' });
  }
  if (typeof artifact.ready !== 'boolean') {
    issues.push({ severity: 'error', message: 'Execution plan missing ready flag.' });
  }
  if (!artifact.executionProfile || typeof artifact.executionProfile !== 'object') {
    issues.push({ severity: 'error', message: 'Execution plan missing executionProfile.' });
  }
  if (!Array.isArray(artifact.blockers)) {
    issues.push({ severity: 'error', message: 'Execution plan missing blockers.' });
  }
  if (!Array.isArray(artifact.rationale)) {
    issues.push({ severity: 'error', message: 'Execution plan missing rationale.' });
  }
  if (!Array.isArray(artifact.promptGuidance)) {
    issues.push({ severity: 'error', message: 'Execution plan missing promptGuidance.' });
  }
  if (typeof artifact.generatedAt !== 'string' || artifact.generatedAt.trim() === '') {
    issues.push({ severity: 'error', message: 'Execution plan missing generatedAt.' });
  }
  return issues;
}

export function validateExecutionReportArtifact(value: unknown): ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  const artifact = value as Partial<VideoExecutionReport>;
  if (typeof artifact.projectSlug !== 'string' || artifact.projectSlug.trim() === '') {
    issues.push({ severity: 'error', message: 'Execution report missing projectSlug.' });
  }
  if (!(artifact.productionMode === 'storyboard' || artifact.productionMode === 'director')) {
    issues.push({ severity: 'error', message: 'Execution report has invalid productionMode.' });
  }
  if (!(artifact.status === 'dry-run-complete' || artifact.status === 'blocked')) {
    if (artifact.status !== 'live-submitted') {
      issues.push({ severity: 'error', message: 'Execution report has invalid status.' });
    }
  }
  if (typeof artifact.dryRun !== 'boolean') {
    issues.push({ severity: 'error', message: 'Execution report missing dryRun flag.' });
  }
  if (!Array.isArray(artifact.blockers)) {
    issues.push({ severity: 'error', message: 'Execution report missing blockers.' });
  }
  if (!Array.isArray(artifact.executedSteps)) {
    issues.push({ severity: 'error', message: 'Execution report missing executedSteps.' });
  }
  if (artifact.submission && typeof artifact.submission !== 'object') {
    issues.push({ severity: 'error', message: 'Execution report submission must be an object when present.' });
  }
  if (artifact.poll && typeof artifact.poll !== 'object') {
    issues.push({ severity: 'error', message: 'Execution report poll must be an object when present.' });
  }
  if (typeof artifact.generatedAt !== 'string' || artifact.generatedAt.trim() === '') {
    issues.push({ severity: 'error', message: 'Execution report missing generatedAt.' });
  }
  return issues;
}
