import storyboardManifest from './pipeline-manifests/storyboard.json' with { type: 'json' };
import directorManifest from './pipeline-manifests/director.json' with { type: 'json' };
import type { VideoPipelineManifest, VideoProductionMode } from './types.js';

const BUILTIN_PIPELINE_MANIFESTS: Record<VideoProductionMode, VideoPipelineManifest> = {
  storyboard: storyboardManifest as VideoPipelineManifest,
  director: directorManifest as VideoPipelineManifest,
};

export function getBuiltinPipelineManifest(mode: VideoProductionMode): VideoPipelineManifest {
  return BUILTIN_PIPELINE_MANIFESTS[mode];
}

export function listBuiltinPipelineManifests(): VideoPipelineManifest[] {
  return Object.values(BUILTIN_PIPELINE_MANIFESTS);
}
