import type {
  ProviderPath,
  ProviderRouteId,
  VideoOperationKind,
  VideoProvider,
} from './provider-platform/types.js';

export type VideoProductionMode = 'storyboard' | 'director';

export type VideoProviderAvailability = 'available' | 'degraded' | 'unavailable';

export interface VideoProviderRuntimeDependencyStatus {
  name: 'python3' | 'bun' | 'ffmpeg';
  available: boolean;
  path?: string;
}

export interface VideoProviderRouteStatusReport {
  routeId: ProviderRouteId;
  provider: VideoProvider;
  displayName: string;
  path: ProviderPath;
  availability: VideoProviderAvailability;
  maturity: 'production' | 'scaffold';
  summary: string;
  supportedOperations: VideoOperationKind[];
  requiredEnvVars: string[];
  availableEnvVars: string[];
  missingEnvVars: string[];
  requiredDependencies: Array<'python3' | 'bun' | 'ffmpeg'>;
  availableDependencies: Array<'python3' | 'bun' | 'ffmpeg'>;
  missingDependencies: Array<'python3' | 'bun' | 'ffmpeg'>;
  issues: string[];
  notes: string[];
}

export interface VideoProviderStatusReport {
  generatedAt: string;
  workspace: {
    root: string;
    ok: boolean;
    issues: string[];
  };
  envSources: string[];
  runtimeDependencies: VideoProviderRuntimeDependencyStatus[];
  routes: VideoProviderRouteStatusReport[];
}

export type VideoStageArtifactName =
  | 'brief'
  | 'clone-plan'
  | 'storyboard'
  | 'asset-manifest'
  | 'execution-plan'
  | 'execution-report'
  | 'review-report'
  | 'publish-report'
  | 'analyze-output'
  | 'assemble-report'
  | 'multi-shot-prompt'
  | 'filmmaking-prompts';

export interface VideoPipelineStageManifest {
  name: 'brief' | 'storyboard' | 'assets' | 'review' | 'publish';
  requiredArtifactsIn?: VideoStageArtifactName[];
  produces: VideoStageArtifactName[];
  checkpointRequired: boolean;
  humanApprovalDefault: boolean;
  successCriteria: string[];
}

export interface VideoPipelineManifest {
  name: string;
  version: string;
  productionMode: VideoProductionMode;
  stages: VideoPipelineStageManifest[];
}

export interface VideoAnalyzeOutput {
  reference: {
    source: string;
    title?: string;
    durationSeconds?: number;
  };
  pacing: {
    label: 'slow' | 'medium' | 'fast' | 'mixed';
    notes: string[];
  };
  structure: {
    hook?: string;
    beats: string[];
    ending?: string;
  };
  motionClassification: {
    primaryMode: 'motion-clips' | 'animated-stills' | 'mixed' | 'unknown';
    notes: string[];
  };
  keep: string[];
  change: string[];
  reusableVariables: string[];
  styleLayers?: string[];
  beatCompression?: {
    targetDurationSeconds: number;
    maxBeats: number;
    dialogueWordBudget: number;
    notes: string[];
  };
  technicalNotes?: string[];
  dialogueNotes?: string[];
  generatedAt: string;
}

export interface LegacyImportSummary {
  sourcePath: string;
  importedAt: string;
  imageCount: number;
  videoCount: number;
  finalCount: number;
  telemetryCount: number;
  manifestPresent: boolean;
  queueFilePresent: boolean;
  queuePendingStatusDetected: boolean;
  queueStatusMismatch: boolean;
  nestedVideoCount: number;
  nestedFinalCount: number;
  nestedOutputRootDetected: boolean;
  inferredCurrentStage: string | null;
  inferredLastCompletedStage: string | null;
  inferredCheckpointStatus: string | null;
}

export interface VideoExecutionPlan {
  projectSlug: string;
  productionMode: VideoProductionMode;
  operationKind: VideoOperationKind;
  recommendedRouteId: ProviderRouteId | null;
  executionProfile: {
    aspectRatio: '16:9' | '9:16' | '1:1';
    quality: 'fast' | 'quality';
    resolution: '720p' | '1080p';
    generateAudio: boolean;
    outputCount: number;
  };
  ready: boolean;
  blockers: string[];
  rationale: string[];
  promptGuidance: Array<{
    name: string;
    reason: string;
    category: 'provider' | 'framework';
  }>;
  generatedAt: string;
}

export interface VideoExecutionTask {
  sceneIndex: number;
  prompt: string;
  inputKind: 'text' | 'image' | 'video';
  referencePaths: string[];
  referenceSlots?: Array<{
    slot: string;
    role: string;
    label: string;
    path?: string;
  }>;
  sourceAssetIds: string[];
  backendHints: string[];
  characters: string[];
  durationSeconds?: number;
  promptPacketVariant?: string;
  /**
   * When a scene was resolved via chain-from-prev, this carries the source
   * candidate id so downstream adapters can record provenance. Absent when the
   * scene is not chained.
   */
  chainedFromCandidateId?: string;
}

export interface VideoExecutionPayload {
  workspaceRoot: string;
  projectSlug: string;
  productionMode: VideoProductionMode;
  routeId: ProviderRouteId;
  operationKind: VideoOperationKind;
  executionProfile: {
    aspectRatio: '16:9' | '9:16' | '1:1';
    quality: 'fast' | 'quality';
    resolution: '720p' | '1080p';
    generateAudio: boolean;
    outputCount: number;
  };
  generatedAt: string;
  outputDir: string;
  tasks: VideoExecutionTask[];
  promptGuidance: Array<{
    name: string;
    reason: string;
    category: 'provider' | 'framework';
  }>;
}

export interface VideoExecutionPollResult {
  status: 'pending' | 'completed' | 'failed';
  externalJobId: string | null;
  outputs: Array<{
    id: string;
    kind: 'image' | 'video' | 'audio' | 'subtitle' | 'other';
    path: string;
    sceneIndex?: number;
    backend?: string;
  }>;
  issues: string[];
  rawResult: unknown;
}

export interface VideoExecutionCancelResult {
  status: 'cancelled' | 'unsupported';
  externalJobId: string | null;
  issues: string[];
  rawResult: unknown;
}

export interface VideoExecutionReport {
  projectSlug: string;
  productionMode: VideoProductionMode;
  operationKind: VideoOperationKind;
  routeId: ProviderRouteId | null;
  status: 'dry-run-complete' | 'live-submitted' | 'blocked';
  dryRun: boolean;
  generatedAt: string;
  blockers: string[];
  executedSteps: string[];
  taskCount?: number;
  submission?: {
    adapterCommand?: string;
    externalJobId?: string | null;
    rawResult?: unknown;
  };
  /**
   * When the execute runtime wrote per-scene candidates (candidate mode), this
   * records which candidate id was created for each scene in this run. Poll
   * refreshes use this map to update candidate status without re-reading the
   * storyboard. Absent on legacy asset-manifest runs.
   */
  candidatesByScene?: Array<{
    sceneIndex: number;
    candidateId: string;
  }>;
  poll?: {
    lastCheckedAt: string;
    status: 'pending' | 'completed' | 'failed';
    issues: string[];
    outputsIngested?: number;
    rawResult?: unknown;
  };
}

export interface CharacterConsistencyReport {
  slug: string;
  ok: boolean;
  referencedCharacters: string[];
  missingProfiles: string[];
  missingReferenceAssets: string[];
  issues: string[];
}

export type ReferenceSheetType =
  | 'identity'
  | 'outfit-material'
  | 'environment'
  | 'motion-camera'
  | 'palette-mood';

export type ReferenceRole =
  // identity
  | 'identity' | 'wardrobe' | 'silhouette' | 'age-reference'
  // outfit-material
  | 'outfit' | 'material' | 'accessory' | 'texture'
  | 'product-hero' | 'product-variant' | 'product-in-use' | 'packaging'
  // environment
  | 'location' | 'set-dressing' | 'weather' | 'time-of-day'
  // motion-camera
  | 'motion-rhythm' | 'camera-behavior' | 'blocking' | 'shot-framing'
  // palette-mood
  | 'palette' | 'composition' | 'mood' | 'lighting-reference';

export type GbRefKind = 'character' | 'product' | 'scene' | 'style-preset' | 'reference-group';

export interface GbRef {
  kind: GbRefKind;
  id: number;
}

export type ReferenceEntry =
  | { path: string; role: ReferenceRole; note?: string }
  | { gbRef: GbRef; role: ReferenceRole; note?: string };

export interface ReferenceSheetBindings {
  sceneIndices: number[];
}

export interface ReferenceSheet {
  id: string;
  type: ReferenceSheetType;
  name: string;
  description?: string;
  characterName?: string;
  references: ReferenceEntry[];
  bindings: ReferenceSheetBindings;
  createdAt: string;
  updatedAt: string;
}

export interface ReferenceSheetsArtifact {
  schemaVersion: 1;
  sheets: ReferenceSheet[];
}

export type SceneCandidateStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface SceneCandidateOutput {
  kind: 'video' | 'audio' | 'image';
  path: string;
  durationSec?: number;
}

export interface SceneCandidateSource {
  executionRound: number;
  adapter: 'builtin' | 'shim' | 'custom' | 'native';
  externalJobId?: string;
  chainedFromCandidateId: string | null;
}

export interface SceneCandidate {
  id: string;
  generationRound: number;
  prompt: string;
  route: string;
  submittedAt: string;
  completedAt?: string;
  status: SceneCandidateStatus;
  outputs: SceneCandidateOutput[];
  source: SceneCandidateSource;
}

export interface SceneCandidatesEntry {
  sceneIndex: number;
  candidates: SceneCandidate[];
}

export interface SceneCandidatesArtifact {
  schemaVersion: 1;
  scenes: SceneCandidatesEntry[];
}

export interface SceneSelectionEntry {
  sceneIndex: number;
  selectedCandidateId: string | null;
  rejectedCandidateIds: string[];
  pendingCandidateIds: string[];
  rerollRequested: boolean;
  chainFromPrev: boolean;
  notes?: string;
}

export interface SceneSelectionArtifact {
  schemaVersion: 1;
  scenes: SceneSelectionEntry[];
}
