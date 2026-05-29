export type ProviderPath = "direct" | "useapi";

export type VideoProvider = "veo" | "runway" | "seedance";

export type RoutingPolicyTag = "balanced" | "trust-first" | "capability-first";

export type NormalizedAspectRatio = "landscape" | "portrait";

export type VideoWorkflowKind =
  | "ad-creative-variants"
  | "product-demo-spokesperson"
  | "generic";

export type VideoOperationKind =
  | "text-to-video"
  | "image-to-video"
  | "frames-to-video"
  | "ingredients-to-video"
  | "video-to-video"
  | "extend"
  | "edit"
  | "add-audio";

export type ProviderControl =
  | "audio"
  | "first-frame"
  | "last-frame"
  | "reference-images"
  | "multi-shot"
  | "lip-sync"
  | "motion-control"
  | "reusable-elements"
  | "native-extend"
  | "native-edit"
  | "camera-grammar"
  | "world-consistency";

export type ProviderRouteId =
  | "veo-direct"
  | "veo-useapi"
  | "runway-useapi"
  | "dreamina-useapi"
  | "seedance-direct";

export type ProviderHealthState = "healthy" | "degraded" | "offline" | "deprecated";

export interface ProviderEscapeHatchOption {
  name: string;
  description: string;
}

export interface ProviderEscapeHatch {
  name: string;
  description: string;
  options: ProviderEscapeHatchOption[];
}

export interface ProviderOperationSupport {
  operation: VideoOperationKind;
  aspectRatios: NormalizedAspectRatio[];
  maxReferenceImages?: number;
  notes?: string[];
}

export interface VideoProviderDescriptor {
  id: ProviderRouteId;
  provider: VideoProvider;
  displayName: string;
  path: ProviderPath;
  summary: string;
  controls: ProviderControl[];
  operationSupport: ProviderOperationSupport[];
  routingHints: {
    latencyClass: "low" | "medium" | "high";
    costClass: "free" | "low" | "medium" | "high";
    trustClass: "direct" | "aggregator";
    preferredWorkflows: VideoWorkflowKind[];
  };
  escapeHatches: ProviderEscapeHatch[];
  notes?: string[];
}

export interface ProviderHealthStatus {
  state: ProviderHealthState;
  updatedAt: string;
  notes?: string[];
}

export interface ProviderRoutingRequest {
  operation: VideoOperationKind;
  aspectRatio: NormalizedAspectRatio;
  workflow: VideoWorkflowKind;
  requiredControls?: ProviderControl[];
  preferredProvider?: VideoProvider;
  preferredPath?: ProviderPath;
  allowProviders?: ProviderRouteId[];
  denyProviders?: ProviderRouteId[];
  preferLowCost?: boolean;
  preferLowLatency?: boolean;
  providerOptions?: Record<string, unknown>;
}

export interface ProviderRoutingPolicy {
  tag: RoutingPolicyTag;
  preferDirectForTrust: boolean;
  preferUseApiWhenCapabilitiesUnlock: boolean;
  allowDeprecatedProviders: boolean;
  allowDegradedProviders: boolean;
  providerOrder: ProviderRouteId[];
}

export interface VideoProviderRouteDecision {
  route: VideoProviderDescriptor;
  score: number;
  reasons: string[];
  retainedEscapeHatches: ProviderEscapeHatch[];
}

export interface VideoProviderRoutingResult {
  primary: VideoProviderRouteDecision;
  fallbacks: VideoProviderRouteDecision[];
  filteredOut: Array<{
    routeId: ProviderRouteId;
    reason: string;
  }>;
}

export type TelemetryVerdict = "accepted" | "rejected" | "needs-edit" | "error";

export interface VideoRunTelemetryRecord {
  runId: string;
  recordedAt: string;
  workflow: VideoWorkflowKind;
  operation: VideoOperationKind;
  routeId: ProviderRouteId;
  provider: VideoProvider;
  path: ProviderPath;
  latencyMs: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  retryCount: number;
  outputDurationSeconds?: number;
  verdict: TelemetryVerdict;
  failureCause?: string;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkScenario {
  id: string;
  workflow: VideoWorkflowKind;
  description: string;
  primaryGoal: string;
  preferredRoutes: ProviderRouteId[];
  metricBudgets: {
    minimumApprovalRate: number;
    maximumMedianLatencyMs: number;
    maximumCostPerApprovedMinuteUsd: number;
    maximumRetryRate: number;
  };
  humanRubric: string[];
}

export interface BenchmarkWorkflowScore {
  workflow: VideoWorkflowKind;
  scenarioIds: string[];
  sampleSize: number;
  approvalRate: number;
  medianLatencyMs: number;
  retryRate: number;
  costPerApprovedMinuteUsd: number;
  pass: boolean;
  failedBudgets: string[];
}

export interface BenchmarkReport {
  generatedAt: string;
  scenarioCount: number;
  scores: BenchmarkWorkflowScore[];
}
