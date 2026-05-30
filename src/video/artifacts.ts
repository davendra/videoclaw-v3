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
    /**
     * Optional reference role hint. A `background-plate` is a scene-context-free
     * environment/base reference (the banana-pro-director `base-ref` step); the
     * filmmaking-prompts reference map lifts it ahead of character sheets and
     * scene plates. Absent → treated as a scene plate when it carries a
     * `sceneIndex` (unchanged behavior).
     */
    role?: 'background-plate';
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

export interface AssembleReportArtifact {
  projectSlug: string;
  generatedAt: string;
  status: 'complete' | 'partial' | 'dry-run' | 'failed';
  brandProfile?: string | null;
  outputPath?: string;
  manifest: Array<{
    kind: 'narration' | 'music' | 'title-card' | 'slide-animation' | 'final-video';
    path: string;
    durationMs: number;
    sceneIndex?: number;
    sizeBytes: number;
    generator: string;
  }>;
  warnings?: string[];
  events?: string[];
}

export function createAssembleReportArtifact(
  input: Omit<AssembleReportArtifact, 'generatedAt'> & { generatedAt?: string },
): AssembleReportArtifact {
  return {
    ...input,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
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
  | AssembleReportArtifact
  | VideoAnalyzeOutput;
