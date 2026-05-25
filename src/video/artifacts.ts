import type { VideoAnalyzeOutput, VideoProductionMode } from './types.js';

export interface BriefArtifact {
  title: string;
  intent: string;
  productionMode: VideoProductionMode;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface StoryboardArtifact {
  projectSlug: string;
  productionMode: VideoProductionMode;
  scenes: Array<{
    sceneIndex: number;
    description: string;
    scenePrompt?: {
      imagePrompt?: string;
      animationPrompt?: string;
      cameraMove?: 'push-in' | 'pull-out' | 'tracking' | 'crane' | 'orbit' | 'static';
      styleFooter?: string;
    };
    characters?: string[];
    dialogue?: string;
    durationSeconds?: number;
  }>;
}

export interface AssetManifestArtifact {
  projectSlug: string;
  assets: Array<{
    id: string;
    kind: 'image' | 'video' | 'audio' | 'subtitle' | 'other';
    path: string;
    sceneIndex?: number;
    backend?: string;
  }>;
}

export interface ReviewReportArtifact {
  projectSlug: string;
  verdict: 'pass' | 'retry' | 'fail';
  generatedAt: string;
  findings?: string[];
  metrics?: Record<string, unknown>;
}

export interface PublishReportArtifact {
  projectSlug: string;
  status: 'ready' | 'published' | 'blocked';
  generatedAt: string;
  finalOutputPath?: string;
  notes?: string[];
}

export function createBriefArtifact(
  input: Omit<BriefArtifact, 'createdAt'> & { createdAt?: string },
): BriefArtifact {
  return {
    ...input,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function createReviewReportArtifact(
  input: Omit<ReviewReportArtifact, 'generatedAt'> & { generatedAt?: string },
): ReviewReportArtifact {
  return {
    ...input,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

export function createPublishReportArtifact(
  input: Omit<PublishReportArtifact, 'generatedAt'> & { generatedAt?: string },
): PublishReportArtifact {
  return {
    ...input,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

export function createStoryboardArtifact(input: StoryboardArtifact): StoryboardArtifact {
  return {
    ...input,
    scenes: [...input.scenes].sort((left, right) => left.sceneIndex - right.sceneIndex),
  };
}

export type CanonicalArtifact =
  | BriefArtifact
  | StoryboardArtifact
  | AssetManifestArtifact
  | ReviewReportArtifact
  | PublishReportArtifact
  | VideoAnalyzeOutput;
