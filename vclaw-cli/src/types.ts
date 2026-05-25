/**
 * Shared type definitions for veo-cli
 */

// Project types
export type Project = {
  projectId: string;
  projectInfo: {
    projectTitle: string;
    toolName?: string;
  };
};

export type ProjectResponse<T> = {
  result: {
    data: {
      json: {
        result: T;
        status: number;
        statusText: string;
      };
    };
  };
};

export type SearchProjectWorkflowsOptions = {
  pageSize?: number;
  toolName?: string;
  rawQuery?: string;
  mediaType?: string;
  cursor?: string | null;
  fetchBookmarked?: boolean;
};

export type MediaGenerationId = {
  mediaType: string;
  projectId: string;
  workflowId: string;
  workflowStepId: string;
  mediaKey: string;
};

export type GeneratedVideo = {
  seed: number;
  mediaGenerationId: string;
  prompt: string;
  aspectRatio: string;
};

export type VideoData = {
  generatedVideo: GeneratedVideo;
  fifeUri: string;
  servingBaseUri: string;
};

export type MediaData = {
  videoData?: VideoData;
};

export type MediaExtraData = {
  mediaTitle: string;
  toolName: string;
  mediaType: string;
  videoExtraData: Record<string, unknown>;
};

export type MediaGeneration = {
  mediaGenerationId: MediaGenerationId;
  mediaData: MediaData;
  mediaExtraData: MediaExtraData;
};

export type ToolInfo = {
  toolName: string;
};

export type VideoModelControlInput = {
  videoModelName: string;
  videoGenerationMode: string;
  videoModelDisplayName: string;
  videoAspectRatio: string;
};

export type VideoGenerationRequestData = {
  videoModelControlInput: VideoModelControlInput;
};

export type PromptInput = {
  textInput: string;
};

export type RequestData = {
  videoGenerationRequestData?: VideoGenerationRequestData;
  promptInputs?: PromptInput[];
};

export type WorkflowStepLog = {
  stepCreationTime: string;
  requestData: RequestData;
};

export type WorkflowStep = {
  workflowStepId: string;
  toolInfo: ToolInfo;
  mediaGenerations: MediaGeneration[];
  workflowStepLog: WorkflowStepLog;
};

export type Workflow = {
  workflowId: string;
  workflowSteps: WorkflowStep[];
  createTime: string;
};

export type WorkflowResult = {
  workflows: Workflow[];
  nextPageToken?: string | null;
};

export type SearchProjectWorkflowsResponse = ProjectResponse<WorkflowResult>;

export type SearchUserProjectsOptions = {
  pageSize?: number;
  toolName?: string;
  cursor?: string | null;
};

export type UserProject = Project & {
  creationTime?: string;
};

export type UserProjectsResult = {
  projects: UserProject[];
  nextPageToken?: string | null;
};

export type SearchUserProjectsResponse = ProjectResponse<UserProjectsResult>;

export type Operation = {
  operation: {
    name: string;
    metadata: {
      "@type": string;
      name: string;
      video: {
        seed: number;
        mediaGenerationId: string;
        prompt: string;
        fifeUrl: string;
        mediaVisibility: string;
        servingBaseUri: string;
        model: string;
        isLooped: boolean;
        aspectRatio: string;
      };
    };
  };
  sceneId: string;
  mediaGenerationId: string;
  status: string;
};

export type VideoModel = {
  key: string;
  supportedAspectRatios: string[];
  accessType: string;
  capabilities: string[];
  videoLengthSeconds: number;
  videoGenerationTimeSeconds: number;
  displayName: string;
  creditCost: number;
  framesPerSecond: number;
  paygateTier: string;
  modelAccessInfo: {
    paygateAccessBlocked?: boolean;
  };
  modelMetadata: {
    veoModelName?: string;
    modelQuality?: string;
  };
  modelStatus?: string;
  shareCardDisplayName: string;
  supportedResolutions?: string[];
};

// Video aspect ratio type
export type VideoAspectRatio =
  | "VIDEO_ASPECT_RATIO_LANDSCAPE"
  | "VIDEO_ASPECT_RATIO_PORTRAIT";

// Configuration types
export type Config = {
  paths: {
    prompts: string;
    cookies: string;
    outputDir: string;
  };
  browser: {
    headless: boolean;
  };
  quiet: boolean;
  timing: {
    pollIntervalMs: number;
    maxPollAttempts: number;
    requestTimeoutMs: number;
    downloadTimeoutMs: number;
    interPromptDelayMs: number;
    loginWaitMs: number;
  };
  video: {
    outputsPerPrompt: number;
    isSeedLocked: boolean;
    seed: number | null;
    preferredAspectRatio: VideoAspectRatio | null;
    preferredModel: string | null;
    audioEnabled: boolean;
  };
};

// Session type for API authentication
export type Session = {
  accessToken: string;
  user: {
    name: string;
    email: string;
  };
};

// Parsed prompt types
export type ParsedPrompt =
  | { type: "text"; prompt: string }
  | { type: "image"; prompt: string; imagePath: string }
  | { type: "frames"; prompt: string; startPath: string; endPath: string }
  | { type: "ingredients"; prompt: string; imagePaths: string[] };

// Image upload result type
export type ImageUploadResult = {
  mediaGenerationId: string;
  imageUri: string;
};

// Video generation options
export type VideoGenerationOptions = {
  project: Project;
  aspectRatio: VideoAspectRatio;
  videoModelKey: string;
  isSeedLocked: boolean;
  outputsPerPrompt: number;
  requestTimeoutMs: number;
  userPaygateTier?: string;
  seed?: number;
  startImageId?: string;
  endImageId?: string;
  referenceImageIds?: string[];
};

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base error class for veo-cli errors
 */
export class VeoCliError extends Error {
  readonly code: string;
  readonly isRetryable: boolean;

  constructor(message: string, code: string, isRetryable: boolean = false) {
    super(message);
    this.name = 'VeoCliError';
    this.code = code;
    this.isRetryable = isRetryable;
  }
}

/**
 * Authentication error (login required, invalid cookies, etc.)
 */
export class AuthenticationError extends VeoCliError {
  constructor(message: string = 'Authentication required') {
    super(message, 'AUTH_ERROR', false);
    this.name = 'AuthenticationError';
  }
}

/**
 * Rate limit error with retry-after information
 */
export class RateLimitError extends VeoCliError {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number = 60000) {
    super(message, 'RATE_LIMIT', true);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Video generation error with scene context
 */
export class VideoGenerationError extends VeoCliError {
  readonly sceneId?: string;
  readonly endpoint?: string;
  readonly statusCode?: number;

  constructor(
    message: string,
    options?: { sceneId?: string; endpoint?: string; statusCode?: number; isRetryable?: boolean }
  ) {
    super(message, 'VIDEO_GENERATION_ERROR', options?.isRetryable ?? true);
    this.name = 'VideoGenerationError';
    this.sceneId = options?.sceneId;
    this.endpoint = options?.endpoint;
    this.statusCode = options?.statusCode;
  }
}

/**
 * Image upload error
 */
export class ImageUploadError extends VeoCliError {
  readonly imagePath: string;

  constructor(message: string, imagePath: string) {
    super(message, 'IMAGE_UPLOAD_ERROR', true);
    this.name = 'ImageUploadError';
    this.imagePath = imagePath;
  }
}

/**
 * Configuration error (invalid config, missing required fields, etc.)
 */
export class ConfigurationError extends VeoCliError {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message, 'CONFIG_ERROR', false);
    this.name = 'ConfigurationError';
    this.field = field;
  }
}

/**
 * Prompt parsing error
 */
export class PromptParseError extends VeoCliError {
  readonly promptLine: string;

  constructor(message: string, promptLine: string) {
    super(message, 'PROMPT_PARSE_ERROR', false);
    this.name = 'PromptParseError';
    this.promptLine = promptLine;
  }
}
